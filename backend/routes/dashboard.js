const express = require('express');
const { getDatabase, getOne, getAll } = require('../database/schema');
const { authenticateToken } = require('../utils/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const totalOfertas = (await getOne('SELECT COUNT(*) as total FROM ofertas'))?.total || 0;
    const ofertasPublicadas = (await getOne("SELECT COUNT(*) as total FROM ofertas WHERE status = 'publicada'"))?.total || 0;
    const totalCliques = (await getOne('SELECT COUNT(*) as total FROM cliques'))?.total || 0;
    const totalVendas = (await getOne('SELECT COUNT(*) as total FROM vendas'))?.total || 0;
    const comissaoTotal = (await getOne('SELECT COALESCE(SUM(comissao), 0) as total FROM vendas'))?.total || 0;
    const comissaoMes = (await getOne("SELECT COALESCE(SUM(comissao), 0) as total FROM vendas WHERE registrado_em >= date_trunc('month', CURRENT_DATE)"))?.total || 0;
    const totalMembros = (await getOne("SELECT COUNT(DISTINCT ip) as total FROM cliques"))?.total || 0;
    const conversao = totalCliques > 0 ? ((totalVendas / totalCliques) * 100).toFixed(2) : 0;

    const ofertasPorPlataforma = await getAll("SELECT plataforma, COUNT(*) as total FROM ofertas GROUP BY plataforma");
    const ofertasPorStatus = await getAll("SELECT status, COUNT(*) as total FROM ofertas GROUP BY status");
    const ofertasPorCategoria = await getAll("SELECT c.nome, COUNT(o.id) as total FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id GROUP BY o.categoria_id, c.nome ORDER BY total DESC LIMIT 10");
    const ofertasRecentes = await getAll('SELECT o.*, c.nome as categoria_nome FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id ORDER BY o.criado_em DESC LIMIT 10');
    const topProdutos = await getAll("SELECT o.produto, o.imagem, COUNT(cl.id) as cliques FROM ofertas o JOIN cliques cl ON o.id = cl.oferta_id GROUP BY o.id, o.produto, o.imagem ORDER BY cliques DESC LIMIT 10");
    const topVendas = await getAll("SELECT o.produto, o.imagem, COUNT(v.id) as vendas, SUM(v.valor) as valor_total FROM ofertas o JOIN vendas v ON o.id = v.oferta_id GROUP BY o.id, o.produto, o.imagem ORDER BY vendas DESC LIMIT 10");
    const cliquePorDia = await getAll("SELECT date(clicado_em) as data, COUNT(*) as total FROM cliques WHERE clicado_em >= CURRENT_DATE - INTERVAL '30 days' GROUP BY date(clicado_em) ORDER BY data");
    const vendasPorDia = await getAll("SELECT date(registrado_em) as data, COUNT(*) as total, SUM(valor) as valor FROM vendas WHERE registrado_em >= CURRENT_DATE - INTERVAL '30 days' GROUP BY date(registrado_em) ORDER BY data");
    const comissaoPorDia = await getAll("SELECT date(registrado_em) as data, SUM(comissao) as total FROM vendas WHERE registrado_em >= CURRENT_DATE - INTERVAL '30 days' GROUP BY date(registrado_em) ORDER BY data");

    res.json({
      stats: { totalOfertas, ofertasPublicadas, totalCliques, totalVendas, comissaoTotal, comissaoMes, totalMembros, conversao },
      ofertasPorPlataforma, ofertasPorStatus, ofertasPorCategoria,
      ofertasRecentes, topProdutos, topVendas,
      cliquePorDia, vendasPorDia, comissaoPorDia
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar dados do dashboard' });
  }
});

module.exports = router;
