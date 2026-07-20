const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken, requireAdmin } = require('../utils/auth');
const afiliadosService = require('../services/afiliados');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const afiliados = await afiliadosService.listAll();
    res.json(afiliados);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar afiliados' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    await getDatabase();
    const stats = await afiliadosService.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

router.get('/config/:plataforma', async (req, res) => {
  try {
    await getDatabase();
    const config = await afiliadosService.getConfig(req.params.plataforma);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configuração' });
  }
});

router.put('/config/:plataforma', async (req, res) => {
  try {
    await getDatabase();
    await afiliadosService.saveConfig(req.params.plataforma, req.body);
    res.json({ message: 'Configuração atualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
});

router.post('/test/:plataforma', async (req, res) => {
  try {
    await getDatabase();
    const result = await afiliadosService.testConnection(req.params.plataforma);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao testar conexão' });
  }
});

router.post('/', async (req, res) => {
  try {
    await getDatabase();
    const result = await afiliadosService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao cadastrar afiliado' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await getDatabase();
    const result = await afiliadosService.update(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar afiliado' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await getDatabase();
    const result = await afiliadosService.delete(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover afiliado' });
  }
});

module.exports = router;
