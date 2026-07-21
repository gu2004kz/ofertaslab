const { getOne } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

function getPuppeteer() {
  try {
    const pup = require('puppeteer-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    pup.use(stealth());
    return pup;
  } catch (e) {
    return require('puppeteer');
  }
}

class MercadoLivreService {
  constructor() {
    this.lastSearch = 0;
    this.minInterval = 8000;
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

  async waitIfNeeded() {
    const now = Date.now();
    const elapsed = now - this.lastSearch;
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed));
    }
    this.lastSearch = Date.now();
  }

  async searchProducts(query, options = {}) {
    const { limit = 10 } = options;

    const apiResults = await this.searchViaAPI(query, limit);
    if (apiResults.length > 0) return apiResults;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
      }

      const results = await this.searchViaPuppeteer(query, limit);
      if (results.length > 0) return results;
    }

    return [];
  }

  async getAccessToken() {
    const axios = require('axios');
    const app_id = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_app_id'"))?.valor;
    const secret_key = (await getOne("SELECT valor FROM configuracoes WHERE chave = 'ml_secret_key'"))?.valor;
    if (!app_id || !secret_key) return null;

    try {
      const response = await axios.post('https://api.mercadolibre.com/oauth/token',
        new URLSearchParams({ grant_type: 'client_credentials', client_id: app_id, client_secret: secret_key }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
      return response.data.access_token;
    } catch (err) {
      return null;
    }
  }

  async searchViaAPI(query, limit) {
    const axios = require('axios');
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const response = await axios.get(
        `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        { headers: { 'Authorization': `Bearer ${token}` }, timeout: 15000 }
      );

      const config = await this.getConfig();
      const results = [];

      for (const item of (response.data.results || [])) {
        if (!item.price) continue;
        const preco_novo = item.price;
        const preco_antigo = item.original_price && item.original_price > preco_novo ? item.original_price : null;
        if (!preco_antigo) continue;

        const discount = Math.round(((preco_antigo - preco_novo) / preco_antigo) * 100);
        const link = item.permalink;
        const affiliateLink = this.convertLink(link, config);

        results.push({
          produto: item.title,
          preco_novo,
          preco_antigo,
          imagem: item.thumbnail?.replace('http:', 'https:')?.replace('-I.', '-O.') || '',
          link_original: link,
          link_afiliado: affiliateLink,
          plataforma: 'mercadolivre',
          loja: item.seller?.nickname || 'Mercado Livre',
          desconto: discount,
          vendidos: item.sold_quantity || 0,
          avaliacoes: 0,
        });
      }

      await logInfo(`[ML API] Busca "${query}": ${results.length} ofertas`).catch(() => {});
      return results;
    } catch (err) {
      return [];
    }
  }

  async searchViaPuppeteer(query, limit) {
    let browser = null;
    try {
      if (process.env.NODE_ENV === 'production' && !process.env.PUPPETEER_EXECUTABLE_PATH) {
        return [];
      }

      await this.waitIfNeeded();

      const pup = getPuppeteer();
      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
        ]
      };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      browser = await pup.launch(launchOptions);

      const page = await browser.newPage();

      const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      const currentUrl = page.url();
      if (currentUrl.includes('account-verification') || currentUrl.includes('suspicious-traffic')) {
        await browser.close();
        return [];
      }

      await new Promise(r => setTimeout(r, 4000));

      const results = await page.evaluate((limit) => {
        const items = [];
        const productElements = document.querySelectorAll('li.ui-search-layout__item');

        for (const el of productElements) {
          if (items.length >= limit) break;

          const title = el.querySelector('.poly-component__title')?.textContent?.trim();
          if (!title) continue;

          const link = el.querySelector('a.poly-component__title')?.href;
          if (!link) continue;

          const fractions = el.querySelectorAll('.andes-money-amount__fraction');
          let currentPrice = null;
          let originalPrice = null;

          const prevPriceEl = el.querySelector('.andes-money-amount--previous .andes-money-amount__fraction');
          if (prevPriceEl) {
            originalPrice = parseFloat(prevPriceEl.textContent.trim().replace(/\./g, '').replace(/,/g, '.'));
          }

          const currentPriceEl = el.querySelector('.poly-price__current .andes-money-amount__fraction');
          if (currentPriceEl) {
            currentPrice = parseFloat(currentPriceEl.textContent.trim().replace(/\./g, '').replace(/,/g, '.'));
          }

          if (!currentPrice && fractions.length > 0) {
            const allPrices = Array.from(fractions).map(f => parseFloat(f.textContent.trim().replace(/\./g, '').replace(/,/g, '.')));
            if (allPrices.length >= 2) {
              originalPrice = Math.max(...allPrices);
              currentPrice = Math.min(...allPrices);
            } else if (allPrices.length === 1) {
              currentPrice = allPrices[0];
            }
          }

          const img = el.querySelector('img.poly-component__picture')?.src || '';

          if (currentPrice > 0 && title) {
            items.push({ title, link, price: currentPrice, originalPrice: originalPrice || null, image: img.replace('http:', 'https:') });
          }
        }
        return items;
      }, limit);

      await browser.close();
      browser = null;

      const config = await this.getConfig();
      const filteredResults = [];

      for (const item of results) {
        if (item.originalPrice && item.originalPrice > item.price && item.price > 0) {
          const discount = Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100);
          const affiliateLink = this.convertLink(item.link, config);

          filteredResults.push({
            produto: item.title,
            preco_novo: item.price,
            preco_antigo: item.originalPrice,
            imagem: item.image,
            link_original: item.link,
            link_afiliado: affiliateLink,
            plataforma: 'mercadolivre',
            loja: 'Mercado Livre',
            desconto: discount,
            vendidos: 0,
            avaliacoes: 0,
          });
        }
      }

      await logInfo(`[ML] Busca "${query}": ${filteredResults.length} ofertas`).catch(() => {});
      return filteredResults;

    } catch (err) {
      await logError('[ML] Erro na busca', err.message).catch(() => {});
      if (browser) { try { await browser.close(); } catch (e) {} }
      return [];
    }
  }
}

module.exports = new MercadoLivreService();
