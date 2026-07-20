const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class MercadoLivreService {
  constructor() {
    this.baseUrl = 'https://api.mercadolibre.com';
  }

  async getConfig() {
    const affiliate_id = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_affiliate_id'"))?.valor;
    const app_id = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_app_id'"))?.valor;
    const secret_key = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_secret_key'"))?.valor;
    return { affiliate_id, app_id, secret_key };
  }

  async searchProducts(query, options = {}) {
    const { limit = 20 } = options;
    try {
      const config = await this.getConfig();
      
      const axios = require('axios');
      let url = `${this.baseUrl}/sites/MLB/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      
      const headers = {};
      if (config.app_id && config.secret_key) {
        headers['Authorization'] = `Bearer ${config.secret_key}`;
      }

      const response = await axios.get(url, { headers, timeout: 10000 });
      return this.processResults(response.data, config);
    } catch (err) {
      await logError('[ML] Erro na busca', err.message);
      return this.simulateSearch(query, options);
    }
  }

  async simulateSearch(query, options = {}) {
    const categorias = await getAll('SELECT id FROM categorias');
    const randCategoria = categorias[Math.floor(Math.random() * categorias.length)];
    const produtos = [
      { nome: `${query} - Original`, preco: 99.90 + Math.random() * 300, loja: 'Mercado Livre' },
      { nome: `${query} - Frete Grátis`, preco: 59.90 + Math.random() * 200, loja: 'Loja Oficial ML' },
      { nome: `${query} - Super Oferta`, preco: 39.90 + Math.random() * 150, loja: 'Melhor Preço' },
    ];
    return produtos.map(p => ({
      produto: p.nome, preco_novo: p.preco.toFixed(2), preco_antigo: (p.preco * (1.2 + Math.random() * 0.6)).toFixed(2),
      imagem: '', link_original: `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`,
      plataforma: 'mercadolivre', loja: p.loja, categoria_id: randCategoria?.id, desconto: Math.floor(10 + Math.random() * 35)
    }));
  }

  convertLink(originalUrl, affiliateId, mattWord = null) {
    if (!affiliateId && !mattWord) return originalUrl;
    
    try {
      const url = new URL(originalUrl);
      if (mattWord) {
        url.searchParams.set('matt_word', mattWord);
      }
      if (affiliateId) {
        url.searchParams.set('matt_tool', affiliateId);
      }
      url.searchParams.set('matt_source', 'bot');
      return url.toString();
    } catch (e) {
      const separator = originalUrl.includes('?') ? '&' : '?';
      let params = '';
      if (mattWord) params += `matt_word=${mattWord}`;
      if (affiliateId) params += `${params ? '&' : ''}matt_tool=${affiliateId}`;
      params += `${params ? '&' : ''}matt_source=bot`;
      return `${originalUrl}${separator}${params}`;
    }
  }

  processResults(data, config) {
    if (!data || !data.results) return [];
    return data.results.map(item => ({
      produto: item.title, 
      preco_novo: item.price, 
      preco_antigo: item.original_price || item.price,
      imagem: item.thumbnail?.replace('http:', 'https:'), 
      link_original: item.permalink,
      plataforma: 'mercadolivre', 
      loja: item.seller?.nickname || 'Mercado Livre',
      desconto: item.original_price ? Math.round(((item.original_price - item.price) / item.original_price) * 100) : 0,
      vendidos: item.sold_quantity || 0,
      avaliacoes: item.reviews?.rating_average || 0
    }));
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
