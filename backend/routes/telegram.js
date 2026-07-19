const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken, requireAdmin } = require('../utils/auth');

const router = express.Router();
router.use(authenticateToken);

function getBaseUrl(req) {
  return req.app.get('BASE_URL') || 'http://localhost:3000';
}

router.get('/canais', async (req, res) => {
  try {
    await getDatabase();
    const canais = await getAll('SELECT * FROM telegram_canais ORDER BY nome');
    res.json(canais);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar canais' });
  }
});

router.post('/canais', async (req, res) => {
  try {
    await getDatabase();
    const { nome, canal_id, bot_token, horario_inicio, horario_fim, intervalo_minutos, limite_diario } = req.body;
    if (!nome || !canal_id || !bot_token) return res.status(400).json({ error: 'Nome, ID do canal e token do bot são obrigatórios' });
    const result = await runQuery(`INSERT INTO telegram_canais (nome, canal_id, bot_token, horario_inicio, horario_fim, intervalo_minutos, limite_diario) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nome, canal_id, bot_token, horario_inicio || '08:00', horario_fim || '23:00', intervalo_minutos || 15, limite_diario || 50]);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Canal criado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar canal' });
  }
});

router.put('/canais/:id', async (req, res) => {
  try {
    await getDatabase();
    const { nome, canal_id, bot_token, ativo, horario_inicio, horario_fim, intervalo_minutos, limite_diario } = req.body;
    await runQuery(`UPDATE telegram_canais SET nome=?, canal_id=?, bot_token=?, ativo=?, horario_inicio=?, horario_fim=?, intervalo_minutos=?, limite_diario=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      [nome, canal_id, bot_token, ativo !== undefined ? ativo : 1, horario_inicio, horario_fim, intervalo_minutos, limite_diario, req.params.id]);
    res.json({ message: 'Canal atualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar canal' });
  }
});

router.delete('/canais/:id', async (req, res) => {
  try {
    await getDatabase();
    await runQuery('DELETE FROM telegram_canais WHERE id = ?', [req.params.id]);
    res.json({ message: 'Canal removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover canal' });
  }
});

router.get('/publicacoes', async (req, res) => {
  try {
    await getDatabase();
    const publicacoes = await getAll(`SELECT p.*, o.produto, o.preco_novo, o.desconto, o.imagem, tc.nome as canal_nome FROM publicacoes p JOIN ofertas o ON p.oferta_id = o.id JOIN telegram_canais tc ON p.canal_id = tc.id ORDER BY p.enviada_em DESC LIMIT 100`);
    res.json(publicacoes);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar publicações' });
  }
});

router.post('/enviar/:ofertaId', async (req, res) => {
  try {
    await getDatabase();
    const { canal_id } = req.body;
    const oferta = await getOne('SELECT * FROM ofertas WHERE id = ?', [req.params.ofertaId]);
    if (!oferta) return res.status(404).json({ error: 'Oferta não encontrada' });

    let canais;
    if (canal_id) {
      canais = [await getOne('SELECT * FROM telegram_canais WHERE id = ?', [canal_id])];
    } else {
      canais = await getAll('SELECT * FROM telegram_canais WHERE ativo = 1');
    }

    const results = [];
    for (const canal of canais) {
      if (!canal) continue;
      const link = `${getBaseUrl(req)}/go/${oferta.id}`;
      const msg = `🔥 *OFERTA IMPERDÍVEL*\n\n📦 *Produto:* ${oferta.produto}\n\n💸 De: R$ ${oferta.preco_antigo}\n🔥 Por: R$ ${oferta.preco_novo}\n📉 Desconto: ${oferta.desconto}%\n\n🛒 *Comprar:*\n${link}\n\n⚠️ Promoção por tempo limitado.`;

      try {
        const axios = require('axios');
        const response = await axios.post(`https://api.telegram.org/bot${canal.bot_token}/sendMessage`, {
          chat_id: canal.canal_id, text: msg, parse_mode: 'Markdown'
        });
        await runQuery('INSERT INTO publicacoes (oferta_id, canal_id, mensagem_id, status) VALUES (?, ?, ?, ?)', [oferta.id, canal.id, String(response.data.result?.message_id || ''), 'enviada']);
        await runQuery("UPDATE ofertas SET status = 'publicada', publicada_em = CURRENT_TIMESTAMP WHERE id = ?", [oferta.id]);
        await runQuery("UPDATE telegram_canais SET mensagens_enviadas_hoje = mensagens_enviadas_hoje + 1, ultimo_envio = CURRENT_TIMESTAMP WHERE id = ?", [canal.id]);
        results.push({ canal: canal.nome, status: 'enviada' });
      } catch (err) {
        await runQuery('INSERT INTO publicacoes (oferta_id, canal_id, status) VALUES (?, ?, ?)', [oferta.id, canal.id, 'erro']);
        results.push({ canal: canal.nome, status: 'erro', erro: err.message });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar oferta' });
  }
});

router.post('/testar-bot/:canalId', async (req, res) => {
  try {
    await getDatabase();
    const canal = await getOne('SELECT * FROM telegram_canais WHERE id = ?', [req.params.canalId]);
    if (!canal) return res.status(404).json({ error: 'Canal não encontrado' });
    const axios = require('axios');
    const response = await axios.post(`https://api.telegram.org/bot${canal.bot_token}/sendMessage`, {
      chat_id: canal.canal_id, text: '✅ *OFERTASLAB Teste*\n\nBot conectado com sucesso!', parse_mode: 'Markdown'
    });
    res.json({ success: true, message_id: response.data.result?.message_id });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao testar bot: ' + err.message });
  }
});

module.exports = router;
