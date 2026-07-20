const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class MercadoLivreService {
  constructor() {
    this.baseUrl = 'https://api.mercadolibre.com';
  }

  async getConfig() {
    const affiliate_id = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_affiliate_id'"))?.valor;
    const matt_word = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_matt_word'"))?.valor;
    const matt_tool = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_matt_tool'"))?.valor;
    return { affiliate_id, matt_word, matt_tool };
  }

  async searchProducts(query, options = {}) {
    const { limit = 20 } = options;
    try {
      const axios = require('axios');
      const url = `${this.baseUrl}/sites/MLB/search?q=${encodeURIComponent(query)}&limit=${limit}`;

      const response = await axios.get(url, { timeout: 15000 });
      const config = await this.getConfig();
      return this.processResults(response.data, config);
    } catch (err) {
      await logError('[ML] Erro na busca', err.message);
      return [];
    }
  }

  convertLink(originalUrl, config) {
    if (!config || (!config.matt_word && !config.matt_tool && !config.affiliate_id)) return originalUrl;

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

  processResults(data, config) {
    if (!data || !data.results) return [];
    return data.results
      .filter(item => item.original_price && item.original_price > item.price)
      .map(item => {
        const link = this.convertLink(item.permalink, config);
        return {
          produto: item.title,
          preco_novo: item.price,
          preco_antigo: item.original_price || item.price,
          imagem: item.thumbnail?.replace('http:', 'https:').replace('-I.jpg', '-O.jpg').replace('-S.jpg', '-O.jpg'),
          link_original: item.permalink,
          link_afiliado: link,
          plataforma: 'mercadolivre',
          loja: item.seller?.nickname || 'Mercado Livre',
          desconto: item.original_price ? Math.round(((item.original_price - item.price) / item.original_price) * 100) : 0,
          vendidos: item.sold_quantity || 0,
          avaliacoes: item.reviews?.rating_average || 0
        };
      });
  }

  async getItemDetails(itemId) {
    try {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/items/${itemId}`, { timeout: 10000 });
      return response.data;
    } catch (err) {
      await logError('[ML] Erro ao buscar detalhes', err.message);
      return null;
    }
  }

  async getCategories() {
    try {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/sites/MLB/categories`, { timeout: 10000 });
      return response.data;
    } catch (err) {
      await logError('[ML] Erro ao buscar categorias', err.message);
      return [];
    }
  }
}

module.exports = new MercadoLivreService();
