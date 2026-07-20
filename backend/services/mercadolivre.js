const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class MercadoLivreService {
  constructor() {
    this.axios = require('axios');
    this.cheerio = require('cheerio');
  }

  async getConfig() {
    const matt_word = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_matt_word'"))?.valor;
    const matt_tool = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_matt_tool'"))?.valor;
    return { matt_word, matt_tool };
  }

  convertLink(originalUrl, config) {
    if (!config || (!config.matt_word && !config.matt_tool)) return originalUrl;
    try {
      const url = new URL(originalUrl);
      if (config.matt_word) url.searchParams.set('matt_word', config.matt_word);
      if (config.matt_tool) url.searchParams.set('matt_tool', config.matt_tool);
      url.searchParams.set('matt_source', 'bot');
      return url.toString();
    } catch (e) {
      const sep = originalUrl.includes('?') ? '&' : '?';
      let params = [];
      if (config.matt_word) params.push(`matt_word=${config.matt_word}`);
      if (config.matt_tool) params.push(`matt_tool=${config.matt_tool}`);
      params.push('matt_source=bot');
      return `${originalUrl}${sep}${params.join('&')}`;
    }
  }

  async searchProducts(query, options = {}) {
    const { limit = 10 } = options;
    try {
      const config = await this.getConfig();
      const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
      
      const response = await this.axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });

      const $ = this.cheerio.load(response.data);
      const results = [];

      $('li.ui-search-layout__item').each((i, el) => {
        if (results.length >= limit) return false;

        const $el = $(el);
        const titleEl = $el.find('h2.ui-search-item__title, a.ui-search-link__title-card');
        const title = titleEl.text().trim();
        if (!title) return;

        const linkEl = $el.find('a.ui-search-link, a.ui-search-item__group__element');
        const link = linkEl.attr('href');
        if (!link) return;

        const priceWhole = $el.find('.andes-money-amount__fraction').first().text().trim().replace(/\./g, '');
        const priceCents = $el.find('.andes-money-amount__cents').first().text().trim();
        const price = priceCents ? parseFloat(`${priceWhole}.${priceCents}`) : parseFloat(priceWhole);

        const originalPriceEl = $el.find('.andes-money-amount--previous .andes-money-amount__fraction').first();
        const originalPrice = originalPriceEl.length ? parseFloat(originalPriceEl.text().trim().replace(/\./g, '')) : null;

        const imgEl = $el.find('img.ui-search-result-image__element');
        let img = imgEl.attr('data-src') || imgEl.attr('src') || '';
        if (img && !img.startsWith('https:')) img = 'https:' + img;
        if (img) {
          img = img.replace('http:', 'https:');
          if (!img.includes('-O.') && !img.includes('-I.')) {
            img = img.replace(/\.(jpg|jpeg|png)/i, '-O.$1');
          }
        }

        const storeEl = $el.find('.ui-search-official-store-label, .ui-search-item__brand-discoverability');
        const store = storeEl.text().trim() || 'Mercado Livre';

        if (price > 0 && originalPrice && originalPrice > price) {
          const discount = Math.round(((originalPrice - price) / originalPrice) * 100);
          const affiliateLink = this.convertLink(link, config);

          results.push({
            produto: title,
            preco_novo: price,
            preco_antigo: originalPrice,
            imagem: img,
            link_original: link,
            link_afiliado: affiliateLink,
            plataforma: 'mercadolivre',
            loja: store,
            desconto: discount,
            vendidos: 0,
            avaliacoes: 0
          });
        }
      });

      await logInfo(`[ML] Busca "${query}": ${results.length} ofertas encontradas`);
      return results;
    } catch (err) {
      await logError('[ML] Erro na busca', err.message);
      return [];
    }
  }
}

module.exports = new MercadoLivreService();
