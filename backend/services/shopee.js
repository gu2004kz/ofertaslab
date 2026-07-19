const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class ShopeeService {
  constructor() {
    this.baseUrl = 'https://open-api.affiliate.shopee.com.br/graphql';
  }

  async getConfig() {
    const affiliate_id = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'shopee_affiliate_id'"))?.valor;
    const api_key = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'shopee_api_key'"))?.valor;
    return { affiliate_id, api_key };
  }

  async searchProducts(query, options = {}) {
    const { limit = 20 } = options;
    try {
      const config = await this.getConfig();
      if (!config.api_key) {
        return this.simulateSearch(query, options);
      }
      const axios = require('axios');
      const response = await axios.post(this.baseUrl, {
        query: `query { productSearch(keyword: "${query}", sort: sales, limit: ${limit}) { nodes { name price image url affiliateUrl commissionRate } } }`
      }, {
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      return this.processResults(response.data, config);
    } catch (err) {
      await logError('[Shopee] Erro na busca', err.message);
      return this.simulateSearch(query, options);
    }
  }

  async simulateSearch(query, options = {}) {
    const categorias = await getAll('SELECT id FROM categorias');
    const randCategoria = categorias[Math.floor(Math.random() * categorias.length)];
    const produtos = [
      { nome: `${query} - Premium`, preco: 89.90 + Math.random() * 200, loja: 'Shopee Store' },
      { nome: `${query} - Edição Especial`, preco: 49.90 + Math.random() * 150, loja: 'Ofertas Shopee' },
      { nome: `${query} - Promoção`, preco: 29.90 + Math.random() * 100, loja: 'Shopee Mall' },
    ];
    return produtos.map(p => ({
      produto: p.nome, preco_novo: p.preco.toFixed(2), preco_antigo: (p.preco * (1.3 + Math.random() * 0.5)).toFixed(2),
      imagem: '', link_original: `https://shopee.com.br/search?keyword=${encodeURIComponent(query)}`,
      plataforma: 'shopee', loja: p.loja, categoria_id: randCategoria?.id, desconto: Math.floor(15 + Math.random() * 40)
    }));
  }

  convertLink(originalUrl, affiliateId) {
    if (!affiliateId) return originalUrl;
    const sep = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${sep}affiliate_id=${affiliateId}`;
  }

  processResults(data, config) {
    try {
      const nodes = data?.data?.productSearch?.nodes;
      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return [];

      return nodes.map(item => ({
        produto: item.name || item.productName || '',
        preco_novo: this.parsePrice(item.price),
        preco_antigo: this.parsePrice(item.priceBeforeDiscount || item.price),
        imagem: item.image || item.images?.[0] || '',
        link_original: item.affiliateUrl || item.url || item.link || '',
        plataforma: 'shopee',
        loja: item.shopName || item.shop?.name || 'Shopee',
        categoria_id: null,
        desconto: this.calcDiscount(item.priceBeforeDiscount || item.price, item.price),
        vendidos: item.sold || item.sales || 0,
        avaliacoes: item.ratingStar || 0
      }));
    } catch (err) {
      logError('[Shopee] Erro ao processar resultados', err.message);
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
