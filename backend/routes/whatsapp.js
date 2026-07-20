const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken } = require('../utils/auth');
const whatsappPublisher = require('../services/whatsapp');

const router = express.Router();
router.use(authenticateToken);

function getBaseUrl(req) {
  return req.app.get('BASE_URL') || 'http://localhost:3000';
}

router.get('/canais', async (req, res) => {
  try {
    await getDatabase();
    const canais = await getAll('SELECT * FROM whatsapp_canais ORDER BY nome');
    res.json(canais);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar canais' });
  }
});

router.post('/canais', async (req, res) => {
  try {
    await getDatabase();
    const { nome, chat_id, horario_inicio, horario_fim, intervalo_minutos, limite_diario } = req.body;
    if (!nome || !chat_id) return res.status(400).json({ error: 'Nome e ID do chat são obrigatórios' });
    const result = await runQuery(`INSERT INTO whatsapp_canais (nome, chat_id, horario_inicio, horario_fim, intervalo_minutos, limite_diario) VALUES (?, ?, ?, ?, ?, ?)`,
      [nome, chat_id, horario_inicio || '08:00', horario_fim || '23:00', intervalo_minutos || 15, limite_diario || 50]);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Canal criado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar canal' });
  }
});

router.put('/canais/:id', async (req, res) => {
  try {
    await getDatabase();
    const { nome, chat_id, ativo, horario_inicio, horario_fim, intervalo_minutos, limite_diario } = req.body;
    await runQuery(`UPDATE whatsapp_canais SET nome=?, chat_id=?, ativo=?, horario_inicio=?, horario_fim=?, intervalo_minutos=?, limite_diario=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      [nome, chat_id, ativo !== undefined ? ativo : 1, horario_inicio, horario_fim, intervalo_minutos, limite_diario, req.params.id]);
    res.json({ message: 'Canal atualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar canal' });
  }
});

router.delete('/canais/:id', async (req, res) => {
  try {
    await getDatabase();
    await whatsappPublisher.disconnectClient(req.params.id);
    await runQuery('DELETE FROM whatsapp_canais WHERE id = ?', [req.params.id]);
    res.json({ message: 'Canal removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover canal' });
  }
});

router.get('/publicacoes', async (req, res) => {
  try {
    await getDatabase();
    const publicacoes = await getAll(`SELECT wp.*, o.produto, o.preco_novo, o.desconto, o.imagem, wc.nome as canal_nome FROM whatsapp_publicacoes wp JOIN ofertas o ON wp.oferta_id = o.id JOIN whatsapp_canais wc ON wp.canal_id = wc.id ORDER BY wp.enviada_em DESC LIMIT 100`);
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
      canais = [await getOne('SELECT * FROM whatsapp_canais WHERE id = ?', [canal_id])];
    } else {
      canais = await getAll('SELECT * FROM whatsapp_canais WHERE ativo = 1');
    }

    const results = [];
    for (const canal of canais) {
      if (!canal) continue;
      const link = `${getBaseUrl(req)}/go/${oferta.id}`;
      const msg = `🔥 *OFERTA IMPERDÍVEL*\n\n📦 *Produto:* ${oferta.produto}\n\n💸 De: R$ ${oferta.preco_antigo}\n🔥 Por: R$ ${oferta.preco_novo}\n📉 Desconto: ${oferta.desconto}%\n\n🛒 *Comprar:*\n${link}\n\n⚠️ Promoção por tempo limitado.`;

      const result = await whatsappPublisher.sendMessage(canal.id, msg);

      if (result.success) {
        await runQuery('INSERT INTO whatsapp_publicacoes (oferta_id, canal_id, mensagem_id, status) VALUES (?, ?, ?, ?)', [oferta.id, canal.id, String(result.messageId || ''), 'enviada']);
        await runQuery("UPDATE ofertas SET status = 'publicada', publicada_em = CURRENT_TIMESTAMP WHERE id = ?", [oferta.id]);
        await runQuery("UPDATE whatsapp_canais SET mensagens_enviadas_hoje = mensagens_enviadas_hoje + 1, ultimo_envio = CURRENT_TIMESTAMP WHERE id = ?", [canal.id]);
        results.push({ canal: canal.nome, status: 'enviada' });
      } else {
        await runQuery('INSERT INTO whatsapp_publicacoes (oferta_id, canal_id, status) VALUES (?, ?, ?)', [oferta.id, canal.id, 'erro']);
        results.push({ canal: canal.nome, status: 'erro', erro: result.error });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar oferta' });
  }
});

router.post('/conectar/:canalId', async (req, res) => {
  try {
    await getDatabase();
    const canal = await getOne('SELECT * FROM whatsapp_canais WHERE id = ?', [req.params.canalId]);
    if (!canal) return res.status(404).json({ error: 'Canal não encontrado' });

    const client = await whatsappPublisher.initializeClient(canal.id);
    if (!client) return res.status(500).json({ error: 'Erro ao inicializar cliente' });

    res.json({ message: 'Cliente inicializado. Aguardando leitura do QR Code...' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao conectar: ' + err.message });
  }
});

router.get('/qrcode/:canalId', async (req, res) => {
  try {
    const qr = await whatsappPublisher.getQRCode(req.params.canalId);
    res.json({ qr_code: qr });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar QR Code' });
  }
});

router.get('/status/:canalId', async (req, res) => {
  try {
    const status = await whatsappPublisher.getStatus(req.params.canalId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar status' });
  }
});

router.post('/desconectar/:canalId', async (req, res) => {
  try {
    await whatsappPublisher.disconnectClient(req.params.canalId);
    res.json({ message: 'Desconectado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao desconectar' });
  }
});

module.exports = router;
