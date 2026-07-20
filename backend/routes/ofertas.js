const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken } = require('../utils/auth');
const afiliadosService = require('../services/afiliados');

const router = express.Router();
router.use(authenticateToken);

async function generateAffiliateLink(linkOriginal, plataforma) {
  return afiliadosService.generateAffiliateLink(linkOriginal, plataforma);
}

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const { status, plataforma, categoria, busca, page = 1, limit = 50 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND o.status = $' + (params.length + 1); params.push(status); }
    if (plataforma) { where += ' AND o.plataforma = $' + (params.length + 1); params.push(plataforma); }
    if (categoria) { where += ' AND o.categoria_id = $' + (params.length + 1); params.push(categoria); }
    if (busca) { where += ' AND (o.produto LIKE $' + (params.length + 1) + ' OR o.descricao LIKE $' + (params.length + 2) + ')'; params.push(`%${busca}%`, `%${busca}%`); }

    const countRow = await getOne(`SELECT COUNT(*) as total FROM ofertas o ${where}`, params);
    const total = countRow ? countRow.total : 0;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const ofertas = await getAll(`SELECT o.*, c.nome as categoria_nome, c.icone as categoria_icone FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id ${where} ORDER BY o.criado_em DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, parseInt(limit), offset]);
    res.json({ ofertas, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar ofertas' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await getDatabase();
    const oferta = await getOne('SELECT o.*, c.nome as categoria_nome FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id WHERE o.id = $1', [req.params.id]);
    if (!oferta) return res.status(404).json({ error: 'Oferta não encontrada' });
    const historico = await getAll('SELECT * FROM historico_precos WHERE oferta_id = $1 ORDER BY registrado_em DESC', [req.params.id]);
    res.json({ ...oferta, historico_precos: historico });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar oferta' });
  }
});

router.post('/', async (req, res) => {
  try {
    await getDatabase();
    const { produto, descricao, preco_antigo, preco_novo, link_original, imagem, categoria_id, plataforma, loja, palavras_chave } = req.body;
    if (!produto || !link_original || !plataforma) return res.status(400).json({ error: 'Produto, link original e plataforma são obrigatórios' });
    const desconto = preco_antigo && preco_novo ? Math.round(((preco_antigo - preco_novo) / preco_antigo) * 100) : 0;
    const link_afiliado = await generateAffiliateLink(link_original, plataforma);
    const modo = await getOne("SELECT valor FROM configuracoes WHERE chave = 'modo_publicacao'");
    const status = modo && modo.valor === 'automatico' ? 'aprovada' : 'pendente';
    const result = await runQuery(`INSERT INTO ofertas (produto, descricao, preco_antigo, preco_novo, desconto, link_original, link_afiliado, imagem, categoria_id, plataforma, loja, palavras_chave, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [produto, descricao || '', preco_antigo || 0, preco_novo || 0, desconto, link_original, link_afiliado, imagem || '', categoria_id || null, plataforma, loja || '', palavras_chave || '', status]);
    await runQuery('INSERT INTO historico_precos (oferta_id, preco) VALUES ($1, $2)', [result.lastInsertRowid, preco_novo || 0]);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Oferta criada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar oferta' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await getDatabase();
    const { produto, descricao, preco_antigo, preco_novo, link_original, imagem, categoria_id, plataforma, loja, status, palavras_chave } = req.body;
    const desconto = preco_antigo && preco_novo ? Math.round(((preco_antigo - preco_novo) / preco_antigo) * 100) : 0;
    const existing = await getOne('SELECT link_original, plataforma, link_afiliado FROM ofertas WHERE id = $1', [req.params.id]);
    let link_afiliado = existing?.link_afiliado;
    if (link_original && link_original !== existing?.link_original) {
      link_afiliado = await generateAffiliateLink(link_original, plataforma || existing?.plataforma);
    }
    await runQuery(`UPDATE ofertas SET produto=$1, descricao=$2, preco_antigo=$3, preco_novo=$4, desconto=$5, link_original=$6, link_afiliado=$7, imagem=$8, categoria_id=$9, plataforma=$10, loja=$11, status=$12, palavras_chave=$13, atualizado_em=CURRENT_TIMESTAMP WHERE id=$14`,
      [produto, descricao, preco_antigo, preco_novo, desconto, link_original, link_afiliado, imagem, categoria_id, plataforma, loja, status, palavras_chave, req.params.id]);
    if (preco_novo) await runQuery('INSERT INTO historico_precos (oferta_id, preco) VALUES ($1, $2)', [req.params.id, preco_novo]);
    res.json({ message: 'Oferta atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar oferta' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await getDatabase();
    await runQuery('DELETE FROM ofertas WHERE id = $1', [req.params.id]);
    res.json({ message: 'Oferta removida com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover oferta' });
  }
});

router.post('/:id/aprovar', async (req, res) => {
  try {
    await getDatabase();
    await runQuery("UPDATE ofertas SET status = 'aprovada', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    res.json({ message: 'Oferta aprovada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao aprovar oferta' });
  }
});

router.post('/:id/rejeitar', async (req, res) => {
  try {
    await getDatabase();
    await runQuery("UPDATE ofertas SET status = 'rejeitada', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    res.json({ message: 'Oferta rejeitada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao rejeitar oferta' });
  }
});

router.post('/aprovar-todas', async (req, res) => {
  try {
    await getDatabase();
    const result = await runQuery("UPDATE ofertas SET status = 'aprovada', atualizado_em = CURRENT_TIMESTAMP WHERE status = 'pendente'");
    res.json({ message: `${result.changes} ofertas aprovadas` });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao aprovar ofertas' });
  }
});

module.exports = router;
