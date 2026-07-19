const express = require('express');
const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');
const { authenticateToken } = require('../utils/auth');

const router = express.Router();
router.use(authenticateToken);

async function generateAffiliateLink(linkOriginal, plataforma) {
  try {
    const afiliado = await getOne("SELECT * FROM afiliados WHERE plataforma = ? AND ativo = 1 ORDER BY id DESC LIMIT 1", [plataforma]);
    if (!afiliado || !afiliado.affiliate_id) return linkOriginal;

    if (plataforma === 'shopee') {
      const sep = linkOriginal.includes('?') ? '&' : '?';
      return `${linkOriginal}${sep}affiliate_id=${afiliado.affiliate_id}`;
    } else if (plataforma === 'mercadolivre') {
      const sep = linkOriginal.includes('?') ? '&' : '?';
      return `${linkOriginal}${sep}matt_id=${afiliado.affiliate_id}`;
    }
    return linkOriginal;
  } catch (e) {
    return linkOriginal;
  }
}

router.get('/', async (req, res) => {
  try {
    await getDatabase();
    const { status, plataforma, categoria, busca, page = 1, limit = 50 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND o.status = ?'; params.push(status); }
    if (plataforma) { where += ' AND o.plataforma = ?'; params.push(plataforma); }
    if (categoria) { where += ' AND o.categoria_id = ?'; params.push(categoria); }
    if (busca) { where += ' AND (o.produto LIKE ? OR o.descricao LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }

    const countRow = await getOne(`SELECT COUNT(*) as total FROM ofertas o ${where}`, params);
    const total = countRow ? countRow.total : 0;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const ofertas = await getAll(`SELECT o.*, c.nome as categoria_nome, c.icone as categoria_icone FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id ${where} ORDER BY o.criado_em DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    res.json({ ofertas, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar ofertas' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await getDatabase();
    const oferta = await getOne('SELECT o.*, c.nome as categoria_nome FROM ofertas o LEFT JOIN categorias c ON o.categoria_id = c.id WHERE o.id = ?', [req.params.id]);
    if (!oferta) return res.status(404).json({ error: 'Oferta não encontrada' });
    const historico = await getAll('SELECT * FROM historico_precos WHERE oferta_id = ? ORDER BY registrado_em DESC', [req.params.id]);
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
    const result = await runQuery(`INSERT INTO ofertas (produto, descricao, preco_antigo, preco_novo, desconto, link_original, link_afiliado, imagem, categoria_id, plataforma, loja, palavras_chave, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [produto, descricao || '', preco_antigo || 0, preco_novo || 0, desconto, link_original, link_afiliado, imagem || '', categoria_id || null, plataforma, loja || '', palavras_chave || '', status]);
    await runQuery('INSERT INTO historico_precos (oferta_id, preco) VALUES (?, ?)', [result.lastInsertRowid, preco_novo || 0]);
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
    const existing = await getOne('SELECT link_original, plataforma, link_afiliado FROM ofertas WHERE id = ?', [req.params.id]);
    let link_afiliado = existing?.link_afiliado;
    if (link_original && link_original !== existing?.link_original) {
      link_afiliado = await generateAffiliateLink(link_original, plataforma || existing?.plataforma);
    }
    await runQuery(`UPDATE ofertas SET produto=?, descricao=?, preco_antigo=?, preco_novo=?, desconto=?, link_original=?, link_afiliado=?, imagem=?, categoria_id=?, plataforma=?, loja=?, status=?, palavras_chave=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      [produto, descricao, preco_antigo, preco_novo, desconto, link_original, link_afiliado, imagem, categoria_id, plataforma, loja, status, palavras_chave, req.params.id]);
    if (preco_novo) await runQuery('INSERT INTO historico_precos (oferta_id, preco) VALUES (?, ?)', [req.params.id, preco_novo]);
    res.json({ message: 'Oferta atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar oferta' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await getDatabase();
    await runQuery('DELETE FROM ofertas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Oferta removida com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover oferta' });
  }
});

router.post('/:id/aprovar', async (req, res) => {
  try {
    await getDatabase();
    await runQuery("UPDATE ofertas SET status = 'aprovada', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
    res.json({ message: 'Oferta aprovada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao aprovar oferta' });
  }
});

router.post('/:id/rejeitar', async (req, res) => {
  try {
    await getDatabase();
    await runQuery("UPDATE ofertas SET status = 'rejeitada', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
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
