const express = require('express');
const bcrypt = require('bcryptjs');
const { getDatabase, getOne, runQuery } = require('../database/schema');
const { generateToken, authenticateToken } = require('../utils/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    await getDatabase();
    const usuario = await getOne('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (!usuario) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (!bcrypt.compareSync(senha, usuario.senha)) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = generateToken(usuario);
    const { senha: _, ...usuarioSemSenha } = usuario;
    res.json({ token, usuario: usuarioSemSenha });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

router.post('/register', authenticateToken, async (req, res) => {
  try {
    const { nome, email, senha, role } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    await getDatabase();
    const existente = await getOne('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existente) return res.status(409).json({ error: 'Email já cadastrado' });
    const hash = bcrypt.hashSync(senha, 10);
    const result = await runQuery('INSERT INTO usuarios (nome, email, senha, role) VALUES (?, ?, ?, ?)', [nome, email, hash, role || 'admin']);
    res.status(201).json({ id: result.lastInsertRowid, nome, email, role: role || 'admin' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    await getDatabase();
    const usuario = await getOne('SELECT id, nome, email, role, criado_em FROM usuarios WHERE id = ?', [req.user.id]);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(usuario);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { senhaAtual, novaSenha } = req.body;
    await getDatabase();
    const usuario = await getOne('SELECT * FROM usuarios WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(senhaAtual, usuario.senha)) return res.status(401).json({ error: 'Senha atual incorreta' });
    const hash = bcrypt.hashSync(novaSenha, 10);
    await runQuery('UPDATE usuarios SET senha = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Senha atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar senha' });
  }
});

module.exports = router;
