const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class DealCapture {
  constructor() {
    this.shopeeService = require('./shopee');
    this.mlService = require('./mercadolivre');
    this.afiliadosService = require('./afiliados');
    this.pesquisasPadrao = [
      'perfume importado', 'fone bluetooth', 'mouse gamer', 'teclado mecânico',
      'celular samsung', 'air fryer', 'aspirador robô', 'notebook', 'tablet',
      'console ps5', 'capa celular', 'carregador turbo',
      'relogio smartwatch', 'camera sport', 'drone', 'suporte celular',
      'lampada led', 'tomada inteligente', 'extensor sinal'
    ];
  }

  async generateAffiliateLink(linkOriginal, plataforma) {
    return this.afiliadosService.generateAffiliateLink(linkOriginal, plataforma);
  }

  async getActiveSearchTerms() {
    const campanhas = await getAll("SELECT * FROM campanhas WHERE ativa = 1");
    if (campanhas.length === 0) return this.pesquisasPadrao;

    const terms = [];
    campanhas.forEach(c => {
      if (c.palavras_chave) {
        c.palavras_chave.split(',').forEach(kw => {
          const trimmed = kw.trim().toLowerCase();
          if (trimmed && !terms.includes(trimmed)) terms.push(trimmed);
        });
      }
    });
    return terms.length > 0 ? terms : this.pesquisasPadrao;
  }

  async captureAll() {
    const configRows = await getAll("SELECT chave, valor FROM configuracoes WHERE chave IN ('desconto_minimo', 'preco_minimo', 'preco_maximo')");
    const configs = {};
    configRows.forEach(c => configs[c.chave] = parseFloat(c.valor));

    const descontoMin = configs.desconto_minimo || 10;
    const precoMin = configs.preco_minimo || 0;
    const precoMax = configs.preco_maximo || 999999;

    await logInfo('[Capture] Iniciando captura de ofertas...');

    const searches = await this.getActiveSearchTerms();
    const categorias = await getAll('SELECT id, nome FROM categorias');
    const catMap = {};
    categorias.forEach(c => catMap[c.nome.toLowerCase()] = c.id);

    let novasOfertas = 0;
    const maxSearches = Math.min(searches.length, 10);

    for (let i = 0; i < maxSearches; i++) {
      const query = searches[i];
      try {
        const shopeeResults = await this.shopeeService.searchProducts(query, { limit: 10, minPrice: precoMin, maxPrice: precoMax });
        const mlResults = await this.mlService.searchProducts(query, { limit: 10, minPrice: precoMin, maxPrice: precoMax });

        for (const oferta of [...shopeeResults, ...mlResults]) {
          const precoAntigo = parseFloat(oferta.preco_antigo);
          const precoNovo = parseFloat(oferta.preco_novo);
          if (!precoAntigo || precoAntigo <= 0) continue;
          const desconto = Math.round(((precoAntigo - precoNovo) / precoAntigo) * 100);
          if (desconto < descontoMin) continue;
          if (precoNovo < precoMin || precoNovo > precoMax) continue;

          const existe = await getOne('SELECT id FROM ofertas WHERE produto = $1 AND plataforma = $2', [oferta.produto, oferta.plataforma]);
          if (existe) continue;

          const link_afiliado = await this.generateAffiliateLink(oferta.link_original, oferta.plataforma);
          const modo = await getOne("SELECT valor FROM configuracoes WHERE chave = 'modo_publicacao'");
          const status = modo?.valor === 'automatico' ? 'aprovada' : 'pendente';

          const result = await runQuery(`INSERT INTO ofertas (produto, preco_antigo, preco_novo, desconto, link_original, link_afiliado, imagem, categoria_id, plataforma, loja, status, fonte) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [oferta.produto, precoAntigo, precoNovo, desconto, oferta.link_original, link_afiliado, oferta.imagem || '', oferta.categoria_id || null, oferta.plataforma, oferta.loja || '', status, 'auto']);
          await runQuery('INSERT INTO historico_precos (oferta_id, preco) VALUES ($1, $2)', [result.lastInsertRowid, precoNovo]);
          novasOfertas++;
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        await logError(`[Capture] Erro na busca: ${query}`, err.message);
      }
    }

    await logInfo(`[Capture] Captura concluída. ${novasOfertas} novas ofertas.`);
    return novasOfertas;
  }

  async checkPriceDrops() {
    const ofertas = await getAll("SELECT o.id, o.produto, o.preco_novo, o.plataforma FROM ofertas o WHERE o.status IN ('aprovada', 'publicada') AND o.preco_novo > 0");
    let atualizadas = 0;

    for (const oferta of ofertas) {
      try {
        let resultados;
        if (oferta.plataforma === 'shopee') {
          resultados = await this.shopeeService.searchProducts(oferta.produto, { limit: 5 });
        } else {
          resultados = await this.mlService.searchProducts(oferta.produto, { limit: 5 });
        }
        const match = resultados.find(r => r.produto === oferta.produto);
        if (match && parseFloat(match.preco_novo) < oferta.preco_novo) {
          const precoAntigo = parseFloat(match.preco_antigo);
          const precoNovo = parseFloat(match.preco_novo);
          const desconto = precoAntigo > 0 ? Math.round(((precoAntigo - precoNovo) / precoAntigo) * 100) : 0;
          await runQuery('UPDATE ofertas SET preco_antigo=$1, preco_novo=$2, desconto=$3, atualizado_em=CURRENT_TIMESTAMP WHERE id=$4',
            [precoAntigo, precoNovo, desconto, oferta.id]);
          await runQuery('INSERT INTO historico_precos (oferta_id, preco) VALUES ($1, $2)', [oferta.id, precoNovo]);
          atualizadas++;
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        await logError(`[PriceDrop] Erro ao verificar: ${oferta.produto}`, err.message);
      }
    }
    await logInfo(`[PriceDrop] ${atualizadas} ofertas com preço atualizado.`);
    return atualizadas;
  }

  async expireOldOffers() {
    const result = await runQuery("UPDATE ofertas SET status = 'expirada', atualizado_em = CURRENT_TIMESTAMP WHERE status IN ('aprovada', 'publicada') AND publicada_em < NOW() - INTERVAL '30 days'");
    if (result.changes > 0) {
      await logInfo(`[Expira] ${result.changes} ofertas expiradas (>30 dias sem atualização)`);
    }
    return result.changes;
  }
}

module.exports = new DealCapture();
