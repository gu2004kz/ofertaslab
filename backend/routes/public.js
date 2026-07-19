const express = require('express');
const { getDatabase, getOne, getAll } = require('../database/schema');

const router = express.Router();

router.get('/ofertas', async (req, res) => {
  try {
    await getDatabase();
    const ofertas = await getAll("SELECT o.id, o.produto, o.preco_antigo, o.preco_novo, o.desconto, o.imagem, o.link_original, o.plataforma, o.loja, c.nome as categoria FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id WHERE o.status = 'publicada' ORDER BY o.publicada_em DESC LIMIT 50");
    res.json(ofertas);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar ofertas públicas' });
  }
});

router.get('/ofertas/:id', async (req, res) => {
  try {
    await getDatabase();
    const oferta = await getOne("SELECT o.*, c.nome as categoria FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id WHERE o.id = ?", [req.params.id]);
    if (!oferta) return res.status(404).json({ error: 'Oferta não encontrada' });
    res.json(oferta);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar oferta' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    await getDatabase();
    const ofertas = (await getOne("SELECT COUNT(*) as total FROM ofertas WHERE status = 'publicada'"))?.total || 0;
    const lojas = (await getAll("SELECT DISTINCT loja FROM ofertas WHERE loja != '' AND status = 'publicada'")).length;
    res.json({ ofertas, lojas });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar stats' });
  }
});

module.exports = router;
