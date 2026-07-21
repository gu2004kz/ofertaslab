const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');
const crypto = require('crypto');

class AfiliadosService {
  constructor() {
    this.shopeeService = require('./shopee');
    this.mlService = require('./mercadolivre');
  }

  async getConfig(plataforma) {
    const configMap = {
      shopee: {
        affiliate_id: 'shopee_affiliate_id',
        api_key: 'shopee_api_key',
        api_secret: 'shopee_api_secret'
      },
      mercadolivre: {
        affiliate_id: 'ml_affiliate_id',
        matt_word: 'ml_matt_word',
        matt_tool: 'ml_matt_tool'
      }
    };

    const keys = configMap[plataforma];
    if (!keys) return null;

    const config = {};
    for (const [key, configKey] of Object.entries(keys)) {
      const row = await getOne("SELECT valor FROM configuracoes WHERE chave = ?", [configKey]);
      config[key] = row?.valor || '';
    }
    return config;
  }

  async saveConfig(plataforma, config) {
    const configMap = {
      shopee: {
        affiliate_id: 'shopee_affiliate_id',
        api_key: 'shopee_api_key',
        api_secret: 'shopee_api_secret'
      },
      mercadolivre: {
        affiliate_id: 'ml_affiliate_id',
        matt_word: 'ml_matt_word',
        matt_tool: 'ml_matt_tool'
      }
    };

    const keys = configMap[plataforma];
    if (!keys) throw new Error('Plataforma inválida');

    for (const [key, configKey] of Object.entries(keys)) {
      if (config[key] !== undefined) {
        await runQuery(
          "INSERT INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?) ON CONFLICT (chave) DO UPDATE SET valor = ?, atualizado_em = CURRENT_TIMESTAMP",
          [configKey, config[key], `Configuração ${plataforma} - ${key}`, config[key]]
        );
      }
    }
    await logInfo(`[Afiliados] Configurações ${plataforma} atualizadas`);
  }

  async generateAffiliateLink(originalUrl, plataforma, customAffiliateId = null) {
    try {
      let affiliateId = customAffiliateId;
      let mattWord = null;
      
      if (!affiliateId) {
        const afiliado = await getOne(
          "SELECT affiliate_id FROM afiliados WHERE plataforma = ? AND ativo = 1 ORDER BY id DESC LIMIT 1",
          [plataforma]
        );
        affiliateId = afiliado?.affiliate_id;
      }

      if (!affiliateId && plataforma !== 'mercadolivre') {
        const config = await this.getConfig(plataforma);
        if (!affiliateId) affiliateId = config?.affiliate_id;
      }

      if (plataforma === 'mercadolivre') {
        const config = await this.getConfig(plataforma);
        if (!affiliateId) affiliateId = config?.matt_tool || config?.affiliate_id;
        mattWord = config?.matt_word;
      }

      if (!affiliateId && !mattWord) return originalUrl;

      if (plataforma === 'shopee') {
        return this.shopeeService.convertLink(originalUrl, affiliateId);
      } else if (plataforma === 'mercadolivre') {
        return this.mlService.convertLink(originalUrl, { matt_word: mattWord, matt_tool: affiliateId });
      }

      return originalUrl;
    } catch (err) {
      await logError('[Afiliados] Erro ao gerar link', err.message).catch(() => {});
      return originalUrl;
    }
  }

  async testConnection(plataforma) {
    try {
      const config = await this.getConfig(plataforma);
      
      if (plataforma === 'shopee') {
        if (!config.api_key || !config.api_secret) {
          if (config.affiliate_id) {
            return { success: true, message: 'Configurado para gerar links (sem API). Affiliate ID: ' + config.affiliate_id };
          }
          return { success: false, message: 'Affiliate ID não configurado. Configure pelo menos o Affiliate ID.' };
        }
        
        const axios = require('axios');
        const timestamp = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify({ query: '{ viewer { name } }' });
        const signature = crypto
          .createHash('sha256')
          .update(`${config.affiliate_id}${timestamp}${payload}${config.api_secret}`)
          .digest('hex');

        const response = await axios.post(
          'https://open-api.affiliate.shopee.com.br/graphql',
          { query: '{ viewer { name } }' },
          {
            headers: {
              'Authorization': `SHA256 Credential=${config.affiliate_id}, Timestamp=${timestamp}, Signature=${signature}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        return { success: true, message: 'Conexão API OK', data: response.data };
      } else if (plataforma === 'mercadolivre') {
        if (!config.matt_word && !config.matt_tool && !config.affiliate_id) {
          return { success: false, message: 'Dados de afiliado não configurados. Configure matt_word e matt_tool.' };
        }
        
        const tag = config.matt_word && config.matt_tool 
          ? `matt:${config.matt_word}:${config.matt_tool}` 
          : config.affiliate_id;
        
        const axios = require('axios');
        try {
          const response = await axios.get(
            `https://api.mercadolibre.com/sites/MLB/search?q=celular&limit=1`,
            { timeout: 10000 }
          );
          return { success: true, message: 'Conexão API OK. Tag: ' + tag, data: { total: response.data.paging?.total || 0 } };
        } catch (apiErr) {
          return { success: true, message: 'Configurado para gerar links. Tag: ' + tag };
        }
      }

      return { success: false, message: 'Plataforma não suportada' };
    } catch (err) {
      await logError(`[Afiliados] Erro ao testar conexão ${plataforma}`, err.message);
      return { success: false, message: err.message };
    }
  }

  async getStats() {
    const shopeeCount = await getOne(
      "SELECT COUNT(*) as count FROM afiliados WHERE plataforma = 'shopee' AND ativo = 1"
    );
    const mlCount = await getOne(
      "SELECT COUNT(*) as count FROM afiliados WHERE plataforma = 'mercadolivre' AND ativo = 1"
    );
    const totalActive = await getOne(
      "SELECT COUNT(*) as count FROM afiliados WHERE ativo = 1"
    );

    return {
      shopee: parseInt(shopeeCount?.count || 0),
      mercadolivre: parseInt(mlCount?.count || 0),
      total: parseInt(totalActive?.count || 0)
    };
  }

  async listAll() {
    return getAll('SELECT * FROM afiliados ORDER BY plataforma, conta');
  }

  async create(data) {
    const { plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token } = data;
    
    if (!plataforma || !conta) {
      throw new Error('Plataforma e conta são obrigatórios');
    }

    const result = await runQuery(
       `INSERT INTO afiliados (plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [plataforma, conta, affiliate_id || '', api_key || '', api_secret || '', access_token || '', refresh_token || '']
    );

    await logInfo(`[Afiliados] Novo afiliado cadastrado: ${plataforma} - ${conta}`);
    return { id: result.lastInsertRowid, message: 'Afiliado cadastrado com sucesso' };
  }

  async update(id, data) {
    const { plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token, ativo } = data;
    
    await runQuery(
      `UPDATE afiliados SET plataforma=?, conta=?, affiliate_id=?, api_key=?, api_secret=?, 
       access_token=?, refresh_token=?, ativo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      [plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token, ativo !== undefined ? ativo : 1, id]
    );

    await logInfo(`[Afiliados] Afiliado ${id} atualizado`);
    return { message: 'Afiliado atualizado' };
  }

  async delete(id) {
    await runQuery('DELETE FROM afiliados WHERE id = ?', [id]);
    await logInfo(`[Afiliados] Afiliado ${id} removido`);
    return { message: 'Afiliado removido' };
  }
}

module.exports = new AfiliadosService();
