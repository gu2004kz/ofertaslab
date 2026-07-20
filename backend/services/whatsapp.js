const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class WhatsAppPublisher {
  constructor() {
    this.clients = {};
    this.qrCodes = {};
  }

  async getBaseUrl() {
    try {
      return (await getOne("SELECT valor FROM configuracoes WHERE chave = 'base_url'"))?.valor || 'http://localhost:3000';
    } catch (e) {
      return 'http://localhost:3000';
    }
  }

  formatMessage(oferta, link) {
    const oldPrice = parseFloat(oferta.preco_antigo).toFixed(2);
    const newPrice = parseFloat(oferta.preco_novo).toFixed(2);
    let msg = `🔥 *OFERTA IMPERDÍVEL*\n\n📦 *Produto:* ${oferta.produto}\n\n💸 De: R$ ${oldPrice}\n🔥 Por: R$ ${newPrice}\n📉 Desconto: ${oferta.desconto}%`;
    if (oferta.loja) msg += `\n🏪 Loja: ${oferta.loja}`;
    msg += `\n\n🛒 *Comprar:*\n${link}\n\n⚠️ Promoção por tempo limitado.`;
    return msg;
  }

  async initializeClient(canalId) {
    try {
      const canal = await getOne('SELECT * FROM whatsapp_canais WHERE id = ?', [canalId]);
      if (!canal) return null;

      if (this.clients[canalId] && this.clients[canalId].info) {
        return this.clients[canalId];
      }

      const client = new Client({
        authStrategy: new LocalAuth({ clientId: `whatsapp_${canalId}` }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
      });

      client.on('qr', async (qr) => {
        qrcode.generate(qr, { small: true });
        this.qrCodes[canalId] = qr;
        await runQuery("UPDATE whatsapp_canais SET qr_code = ? WHERE id = ?", [qr, canalId]);
        await logInfo(`[WhatsApp] QR Code gerado para canal ${canalId}`);
      });

      client.on('ready', async () => {
        this.clients[canalId] = client;
        this.qrCodes[canalId] = null;
        await runQuery("UPDATE whatsapp_canais SET conectado = 1, qr_code = NULL WHERE id = ?", [canalId]);
        await logInfo(`[WhatsApp] Cliente conectado para canal ${canalId}`);
      });

      client.on('authenticated', async () => {
        await logInfo(`[WhatsApp] Autenticado para canal ${canalId}`);
      });

      client.on('auth_failure', async (msg) => {
        await logError(`[WhatsApp] Falha na autenticação do canal ${canalId}`, msg);
        await runQuery("UPDATE whatsapp_canais SET conectado = 0 WHERE id = ?", [canalId]);
      });

      client.on('disconnected', async () => {
        delete this.clients[canalId];
        await runQuery("UPDATE whatsapp_canais SET conectado = 0 WHERE id = ?", [canalId]);
        await logInfo(`[WhatsApp] Cliente desconectado do canal ${canalId}`);
      });

      await client.initialize();
      return client;
    } catch (err) {
      await logError(`[WhatsApp] Erro ao inicializar cliente do canal ${canalId}`, err.message);
      return null;
    }
  }

  async sendMessage(canalId, message) {
    try {
      const canal = await getOne('SELECT * FROM whatsapp_canais WHERE id = ?', [canalId]);
      if (!canal) return { success: false, error: 'Canal não encontrado' };

      let client = this.clients[canalId];
      if (!client || !client.info) {
        client = await this.initializeClient(canalId);
        if (!client) return { success: false, error: 'Cliente não conectado' };
        await new Promise(r => setTimeout(r, 5000));
      }

      const chat = await client.getChatById(canal.chat_id);
      const sentMessage = await chat.sendMessage(message);
      return { success: true, messageId: sentMessage.id._serialized };
    } catch (err) {
      await logError(`[WhatsApp] Erro ao enviar mensagem no canal ${canalId}`, err.message);
      return { success: false, error: err.message };
    }
  }

  async publishPendingOffers() {
    const canais = await getAll('SELECT * FROM whatsapp_canais WHERE ativo = 1');
    if (canais.length === 0) return;

    const ofertas = await getAll("SELECT * FROM ofertas WHERE status = 'aprovada' ORDER BY desconto DESC");
    if (ofertas.length === 0) return;

    await logInfo(`[WhatsApp] ${ofertas.length} ofertas para publicar em ${canais.length} canal(is)`);
    let publicadas = 0;
    const baseUrl = await this.getBaseUrl();

    for (const canal of canais) {
      if (!canal.conectado) continue;

      const now = new Date();
      const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (horaAtual < canal.horario_inicio || horaAtual > canal.horario_fim) continue;
      if (canal.mensagens_enviadas_hoje >= canal.limite_diario) continue;

      for (const oferta of ofertas) {
        if (canal.mensagens_enviadas_hoje >= canal.limite_diario) break;

        const jaPublicada = await getOne('SELECT id FROM whatsapp_publicacoes WHERE oferta_id = ? AND canal_id = ? AND status = ?', [oferta.id, canal.id, 'enviada']);
        if (jaPublicada) continue;

        const link = `${baseUrl}/go/${oferta.id}`;
        const msg = this.formatMessage(oferta, link);
        const result = await this.sendMessage(canal.id, msg);

        if (result.success) {
          await runQuery('INSERT INTO whatsapp_publicacoes (oferta_id, canal_id, mensagem_id, status) VALUES (?, ?, ?, ?)', [oferta.id, canal.id, String(result.messageId || ''), 'enviada']);
          await runQuery("UPDATE ofertas SET status = 'publicada', publicada_em = CURRENT_TIMESTAMP WHERE id = ?", [oferta.id]);
          await runQuery("UPDATE whatsapp_canais SET mensagens_enviadas_hoje = mensagens_enviadas_hoje + 1, ultimo_envio = CURRENT_TIMESTAMP WHERE id = ?", [canal.id]);
          await logInfo(`[WhatsApp] Oferta ${oferta.id} publicada no canal ${canal.nome}`);
          publicadas++;
        } else {
          await runQuery('INSERT INTO whatsapp_publicacoes (oferta_id, canal_id, status) VALUES (?, ?, ?)', [oferta.id, canal.id, 'erro']);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    await logInfo(`[WhatsApp] ${publicadas} ofertas publicadas com sucesso`);
    return publicadas;
  }

  async resetDailyCounts() {
    await runQuery('UPDATE whatsapp_canais SET mensagens_enviadas_hoje = 0');
    await logInfo('[WhatsApp] Contadores diários resetados');
  }

  async getStatus(canalId) {
    const client = this.clients[canalId];
    return {
      conectado: !!(client && client.info),
      info: client?.info || null
    };
  }

  async disconnectClient(canalId) {
    try {
      const client = this.clients[canalId];
      if (client) {
        await client.destroy();
        delete this.clients[canalId];
      }
      await runQuery("UPDATE whatsapp_canais SET conectado = 0 WHERE id = ?", [canalId]);
      return true;
    } catch (err) {
      await logError(`[WhatsApp] Erro ao desconectar canal ${canalId}`, err.message);
      return false;
    }
  }

  async getQRCode(canalId) {
    return this.qrCodes[canalId] || null;
  }
}

module.exports = new WhatsAppPublisher();
