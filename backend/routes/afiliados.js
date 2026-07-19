const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken, requireAdmin } = require('../utils/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const afiliados = await getAll('SELECT * FROM afiliados ORDER BY plataforma, conta');
    res.json(afiliados);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar afiliados' });
  }
});

router.post('/', async (req, res) => {
  try {
    await getDatabase();
    const { plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token } = req.body;
    if (!plataforma || !conta) return res.status(400).json({ error: 'Plataforma e conta são obrigatórios' });
    const result = await runQuery(`INSERT INTO afiliados (plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [plataforma, conta, affiliate_id || '', api_key || '', api_secret || '', access_token || '', refresh_token || '']);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Afiliado cadastrado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao cadastrar afiliado' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await getDatabase();
    const { plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token, ativo } = req.body;
    await runQuery(`UPDATE afiliados SET plataforma=?, conta=?, affiliate_id=?, api_key=?, api_secret=?, access_token=?, refresh_token=?, ativo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      [plataforma, conta, affiliate_id, api_key, api_secret, access_token, refresh_token, ativo !== undefined ? ativo : 1, req.params.id]);
    res.json({ message: 'Afiliado atualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar afiliado' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await getDatabase();
    await runQuery('DELETE FROM afiliados WHERE id = ?', [req.params.id]);
    res.json({ message: 'Afiliado removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover afiliado' });
  }
});

module.exports = router;
