const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ofertaslab_secret_key_2024_secure';
const JWT_EXPIRES = '24h';

function generateToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, role: usuario.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token de acesso necessário' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido ou expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

module.exports = { generateToken, authenticateToken, requireAdmin, JWT_SECRET };
