const express = require('express');
const { getDatabase, getOne, getAll } = require('../database/schema');
const { authenticateToken } = require('../utils/auth');

const router = express.Router();
router.use(authenticateToken);

function getDateFilter(periodo) {
  switch (periodo) {
    case '7d': return { sql: "(CURRENT_DATE - INTERVAL '7 days')", params: [] };
    case '90d': return { sql: "(CURRENT_DATE - INTERVAL '90 days')", params: [] };
    case '30d': default: return { sql: "(CURRENT_DATE - INTERVAL '30 days')", params: [] };
  }
}

router.get('/resumo', async (req, res) => {
  try {
    await getDatabase();
    const { periodo = '30d' } = req.query;
    const df = getDateFilter(periodo);

    const cliques = (await getOne(`SELECT COUNT(*) as total FROM cliques WHERE clicado_em >= ${df.sql}`))?.total || 0;
    const vendas = (await getOne(`SELECT COUNT(*) as total FROM vendas WHERE registrado_em >= ${df.sql}`))?.total || 0;
    const receita = (await getOne(`SELECT COALESCE(SUM(valor), 0) as total FROM vendas WHERE registrado_em >= ${df.sql}`))?.total || 0;
    const comissao = (await getOne(`SELECT COALESCE(SUM(comissao), 0) as total FROM vendas WHERE registrado_em >= ${df.sql}`))?.total || 0;
    const ofertas = (await getOne(`SELECT COUNT(*) as total FROM ofertas WHERE criado_em >= ${df.sql}`))?.total || 0;
    const publicacoes = (await getOne(`SELECT COUNT(*) as total FROM publicacoes WHERE enviada_em >= ${df.sql}`))?.total || 0;
    const cliquePorDia = await getAll(`SELECT date(clicado_em) as data, COUNT(*) as total FROM cliques WHERE clicado_em >= ${df.sql} GROUP BY date(clicado_em) ORDER BY data`);
    const vendasPorDia = await getAll(`SELECT date(registrado_em) as data, COUNT(*) as total, SUM(valor) as valor, SUM(comissao) as comissao FROM vendas WHERE registrado_em >= ${df.sql} GROUP BY date(registrado_em) ORDER BY data`);
    const cliquePorCanal = await getAll(`SELECT tc.nome, COUNT(cl.id) as total FROM cliques cl JOIN telegram_canais tc ON cl.canal_id = tc.id WHERE cl.clicado_em >= ${df.sql} GROUP BY cl.canal_id, tc.nome ORDER BY total DESC`);
    const cliquePorPlataforma = await getAll(`SELECT o.plataforma, COUNT(cl.id) as total FROM cliques cl JOIN ofertas o ON cl.oferta_id = o.id WHERE cl.clicado_em >= ${df.sql} GROUP BY o.plataforma ORDER BY total DESC`);
    const topOfertas = await getAll(`SELECT o.id, o.produto, o.imagem, o.preco_novo, o.desconto, COUNT(cl.id) as cliques, (SELECT COUNT(*) FROM vendas WHERE oferta_id = o.id) as vendas FROM ofertas o LEFT JOIN cliques cl ON o.id = cl.oferta_id WHERE cl.clicado_em >= ${df.sql} GROUP BY o.id, o.produto, o.imagem, o.preco_novo, o.desconto ORDER BY cliques DESC LIMIT 20`);
    res.json({ periodo, cliques, vendas, receita, comissao, ofertas, publicacoes, cliquePorDia, vendasPorDia, cliquePorCanal, cliquePorPlataforma, topOfertas });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar analytics' });
  }
});

router.get('/exportar', async (req, res) => {
  try {
    await getDatabase();
    const ofertas = await getAll(`SELECT o.*, c.nome as categoria, (SELECT COUNT(*) FROM cliques WHERE oferta_id = o.id) as total_cliques, (SELECT COUNT(*) FROM vendas WHERE oferta_id = o.id) as total_vendas, (SELECT COALESCE(SUM(comissao), 0) FROM vendas WHERE oferta_id = o.id) as total_comissao FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id ORDER BY o.criado_em DESC`);
    let csv = 'ID,Produto,Plataforma,Preço Original,Preço Atual,Desconto,Status,Cliques,Vendas,Comissão,Criado em\n';
    ofertas.forEach(o => {
      const produto = (o.produto || '').replace(/"/g, '""');
      csv += `${o.id},"${produto}",${o.plataforma},${o.preco_antigo},${o.preco_novo},${o.desconto}%,${o.status},${o.total_cliques || 0},${o.total_vendas || 0},${o.total_comissao || 0},"${o.criado_em}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=ofertaslab-relatorio-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar relatório' });
  }
});

module.exports = router;
