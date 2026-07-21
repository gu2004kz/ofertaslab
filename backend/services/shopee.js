const { getOne } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');
const axios = require('axios');
const crypto = require('crypto');

class ShopeeService {
  constructor() {
    this.graphqlUrl = 'https://open-api.affiliate.shopee.com.br/graphql';
    this.searchUrl = 'https://shopee.com.br/api/v4/search/search_items';
  }

  async getConfig() {
    const affiliate_id = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'shopee_affiliate_id'"))?.valor;
    const api_key = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'shopee_api_key'"))?.valor;
    const api_secret = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'shopee_api_secret'"))?.valor;
    return { affiliate_id, api_key, api_secret };
  }

  generateSignature(appId, timestamp, payload, secret) {
    const data = `${appId}${timestamp}${payload}${secret}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async searchProducts(query, options = {}) {
    const { limit = 20 } = options;

    // 1) Tentar API GraphQL (se configurada)
    const apiResults = await this.searchViaGraphQL(query, limit);
    if (apiResults.length > 0) return apiResults;

    // 2) Tentar API pública de busca
    const webResults = await this.searchViaWebAPI(query, limit);
    if (webResults.length > 0) return webResults;

    return [];
  }

  async searchViaGraphQL(query, limit) {
    try {
      const config = await this.getConfig();

      if (!config.api_key || !config.api_secret) {
        await logInfo('[Shopee] API keys não configuradas. Configure shopee_api_key e shopee_api_secret.').catch(() => {});
        return [];
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        query: `query {
          productSearch(
            keyword: "${query}"
            sort: sales
            limit: ${limit}
          ) {
            nodes {
              name
              price
              image
              url
              affiliateUrl
              commissionRate
              shopName
              sold
              ratingStar
              priceBeforeDiscount
            }
          }
        }`
      });

      const signature = this.generateSignature(
        config.api_key,
        timestamp,
        payload,
        config.api_secret
      );

      const response = await axios.post(
        this.graphqlUrl,
        payload,
        {
          headers: {
            'Authorization': `SHA256 Credential=${config.api_key}, Timestamp=${timestamp}, Signature=${signature}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const results = this.processGraphQLResults(response.data, config);
      await logInfo(`[Shopee GraphQL] Busca "${query}": ${results.length} ofertas`).catch(() => {});
      return results;

    } catch (err) {
      await logError('[Shopee GraphQL] Erro na busca', err.message).catch(() => {});
      return [];
    }
  }

  async searchViaWebAPI(query, limit) {
    try {
      // API pública de busca da Shopee (não oficial, mas funciona)
      const response = await axios.get(
        `https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(query)}&limit=${limit}&newest=0&order=desc&page_type=search`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://shopee.com.br/',
          },
          timeout: 15000
        }
      );

      const config = await this.getConfig();
      const results = [];

      if (response.data && response.data.items) {
        for (const item of response.data.items.slice(0, limit)) {
          const itemBasic = item.item_basic;
          if (!itemBasic) continue;

          const preco_novo = (itemBasic.price || 0) / 100000;
          const preco_antigo = (itemBasic.price_before_discount || itemBasic.price || 0) / 100000;

          if (preco_novo <= 0) continue;
          if (preco_antigo <= preco_novo) continue;

          const discount = Math.round(((preco_antigo - preco_novo) / preco_antigo) * 100);
          if (discount < 5) continue;

          const itemId = itemBasic.itemid;
          const shopId = itemBasic.shopid;
          const link = `https://shopee.com.br/product/${shopId}/${itemId}`;

          // Gerar link de afiliado se configurado
          let link_afiliado = link;
          if (config.affiliate_id) {
            link_afiliado = `https://shopee.com.br/product/${shopId}/${itemId}?affiliate_id=${config.affiliate_id}`;
          }

          const imagem = `https://cf.shopee.com.br/file/${itemBasic.image}`;

          results.push({
            produto: itemBasic.name || '',
            preco_novo,
            preco_antigo,
            imagem,
            link_original: link,
            link_afiliado,
            plataforma: 'shopee',
            loja: itemBasic.shop_name || 'Shopee',
            desconto: discount,
            vendidos: itemBasic.historical_sold || 0,
            avaliacoes: itemBasic.item_rating?.rating_star || 0,
          });
        }
      }

      await logInfo(`[Shopee Web] Busca "${query}": ${results.length} ofertas`).catch(() => {});
      return results;

    } catch (err) {
      await logError('[Shopee Web] Erro na busca', err.message).catch(() => {});
      return [];
    }
  }

  convertLink(originalUrl, affiliateId) {
    if (!affiliateId) return originalUrl;

    try {
      const url = new URL(originalUrl);
      url.searchParams.set('affiliate_id', affiliateId);
      return url.toString();
    } catch (e) {
      const sep = originalUrl.includes('?') ? '&' : '?';
      return `${originalUrl}${sep}affiliate_id=${affiliateId}`;
    }
  }

  processGraphQLResults(data, config) {
    try {
      const nodes = data?.data?.productSearch?.nodes;
      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return [];

      return nodes.map(item => ({
        produto: item.name || item.productName || '',
        preco_novo: this.parsePrice(item.price),
        preco_antigo: this.parsePrice(item.priceBeforeDiscount || item.price),
        imagem: item.image || item.images?.[0] || '',
        link_original: item.affiliateUrl || item.url || item.link || '',
        link_afiliado: item.affiliateUrl || '',
        plataforma: 'shopee',
        loja: item.shopName || item.shop?.name || 'Shopee',
        categoria_id: null,
        desconto: this.calcDiscount(item.priceBeforeDiscount || item.price, item.price),
        vendidos: item.sold || item.sales || 0,
        avaliacoes: item.ratingStar || 0
      }));
    } catch (err) {
      logError('[Shopee] Erro ao processar resultados', err.message).catch(() => {});
      return [];
    }
  }

  parsePrice(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    return 0;
  }

  calcDiscount(oldPrice, newPrice) {
    const old = this.parsePrice(oldPrice);
    const cur = this.parsePrice(newPrice);
    if (old > 0 && cur > 0 && old > cur) {
      return Math.round(((old - cur) / old) * 100);
    }
    return 0;
  }
}

module.exports = new ShopeeService();
