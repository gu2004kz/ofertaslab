const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { logInfo, logError } = require('../utils/helpers');

class TelegramPublisher {
  constructor() {
    this.axios = require('axios');
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

  async sendToChannel(botToken, channelId, message) {
    try {
      const response = await this.axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: channelId, text: message, parse_mode: 'Markdown', disable_web_page_preview: false
      });
      return { success: true, messageId: response.data.result?.message_id };
    } catch (err) {
      await logError('[Telegram] Erro ao enviar mensagem', err.message);
      return { success: false, error: err.message };
    }
  }

  async publishPendingOffers() {
    const canais = await getAll('SELECT * FROM telegram_canais WHERE ativo = 1');
    if (canais.length === 0) return;

    const ofertas = await getAll("SELECT * FROM ofertas WHERE status = 'aprovada' ORDER BY desconto DESC");
    if (ofertas.length === 0) return;

    await logInfo(`[Telegram] ${ofertas.length} ofertas para publicar em ${canais.length} canal(is)`);
    let publicadas = 0;
    const baseUrl = await this.getBaseUrl();

    for (const canal of canais) {
      const now = new Date();
      const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (horaAtual < canal.horario_inicio || horaAtual > canal.horario_fim) continue;
      if (canal.mensagens_enviadas_hoje >= canal.limite_diario) continue;

      for (const oferta of ofertas) {
        if (canal.mensagens_enviadas_hoje >= canal.limite_diario) break;

        const jaPublicada = await getOne('SELECT id FROM publicacoes WHERE oferta_id = ? AND canal_id = ? AND status = ?', [oferta.id, canal.id, 'enviada']);
        if (jaPublicada) continue;

        const link = `${baseUrl}/go/${oferta.id}`;
        const msg = this.formatMessage(oferta, link);
        const result = await this.sendToChannel(canal.bot_token, canal.canal_id, msg);

        if (result.success) {
          await runQuery('INSERT INTO publicacoes (oferta_id, canal_id, mensagem_id, status) VALUES (?, ?, ?, ?)', [oferta.id, canal.id, String(result.messageId || ''), 'enviada']);
          await runQuery("UPDATE ofertas SET status = 'publicada', publicada_em = CURRENT_TIMESTAMP WHERE id = ?", [oferta.id]);
          await runQuery("UPDATE telegram_canais SET mensagens_enviadas_hoje = mensagens_enviadas_hoje + 1, ultimo_envio = CURRENT_TIMESTAMP WHERE id = ?", [canal.id]);
          await logInfo(`[Telegram] Oferta ${oferta.id} publicada no canal ${canal.nome}`);
          publicadas++;
        } else {
          await runQuery('INSERT INTO publicacoes (oferta_id, canal_id, status) VALUES (?, ?, ?)', [oferta.id, canal.id, 'erro']);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    await logInfo(`[Telegram] ${publicadas} ofertas publicadas com sucesso`);
    return publicadas;
  }

  async resetDailyCounts() {
    await runQuery('UPDATE telegram_canais SET mensagens_enviadas_hoje = 0');
    await logInfo('[Telegram] Contadores diários resetados');
  }
}

module.exports = new TelegramPublisher();
