const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken, requireAdmin } = require('../utils/auth');
const { getAllConfigs, setConfig, getLogs } = require('../utils/helpers');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const configs = await getAllConfigs();
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

router.put('/', async (req, res) => {
  try {
    await getDatabase();
    const configs = req.body;
    if (typeof configs === 'object') {
      for (const [chave, valor] of Object.entries(configs)) {
        await setConfig(chave, String(valor));
      }
    }
    res.json({ message: 'Configurações atualizadas' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

router.get('/logs', async (req, res) => {
  try {
    await getDatabase();
    const logs = await getLogs(parseInt(req.query.limite) || 100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

router.get('/backup', async (req, res) => {
  try {
    const { getAll } = require('../database/schema');
    const ofertas = await getAll('SELECT * FROM ofertas ORDER BY id');
    const canais = await getAll('SELECT * FROM telegram_canais ORDER BY id');
    const categorias = await getAll('SELECT * FROM categorias ORDER BY id');
    res.json({ message: 'Backup exportado com sucesso', data: { ofertas, canais, categorias, exported_at: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar backup' });
  }
});

router.get('/campanhas', async (req, res) => {
  try {
    await getDatabase();
    const campanhas = await getAll('SELECT * FROM campanhas ORDER BY criado_em DESC');
    res.json(campanhas);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar campanhas' });
  }
});

router.post('/campanhas', async (req, res) => {
  try {
    await getDatabase();
    const { nome, descricao, desconto_minimo, preco_minimo, preco_maximo, categorias, palavras_chave } = req.body;
    const result = await runQuery('INSERT INTO campanhas (nome, descricao, desconto_minimo, preco_minimo, preco_maximo, categorias, palavras_chave) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nome, descricao || '', desconto_minimo || 10, preco_minimo || 0, preco_maximo || 999999, categorias || '', palavras_chave || '']);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Campanha criada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar campanha' });
  }
});

router.delete('/campanhas/:id', async (req, res) => {
  try {
    await getDatabase();
    await runQuery('DELETE FROM campanhas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Campanha removida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover campanha' });
  }
});

module.exports = router;
