const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken } = require('../utils/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const categorias = await getAll('SELECT c.*, (SELECT COUNT(*) FROM ofertas WHERE categoria_id = c.id) as total_ofertas FROM categorias c ORDER BY c.nome');
    res.json(categorias);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar categorias' });
  }
});

router.post('/', async (req, res) => {
  try {
    await getDatabase();
    const { nome, icone } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const slug = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
    const result = await runQuery('INSERT INTO categorias (nome, slug, icone) VALUES (?, ?, ?)', [nome, slug, icone || '📦']);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Categoria criada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await getDatabase();
    const { nome, icone, ativa } = req.body;
    await runQuery('UPDATE categorias SET nome=?, icone=?, ativa=? WHERE id=?', [nome, icone, ativa !== undefined ? ativa : 1, req.params.id]);
    res.json({ message: 'Categoria atualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await getDatabase();
    await runQuery('DELETE FROM categorias WHERE id = ?', [req.params.id]);
    res.json({ message: 'Categoria removida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover categoria' });
  }
});

module.exports = router;
