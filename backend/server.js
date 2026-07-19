const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initializeDatabase, getDatabase, getOne, getAll, runQuery } = require('./database/schema');
const { startCronJobs } = require('./jobs/scheduler');
const { logInfo, logError } = require('./utils/helpers');

const authRoutes = require('./routes/auth');
const ofertasRoutes = require('./routes/ofertas');
const categoriasRoutes = require('./routes/categorias');
const telegramRoutes = require('./routes/telegram');
const afiliadosRoutes = require('./routes/afiliados');
const analyticsRoutes = require('./routes/analytics');
const configRoutes = require('./routes/config');
const dashboardRoutes = require('./routes/dashboard');
const publicRoutes = require('./routes/public');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set('BASE_URL', BASE_URL);

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
});
app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ofertas', ofertasRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/afiliados', afiliadosRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/public', publicRoutes);

// Sale webhook - affiliate platforms POST here when a sale is confirmed
app.post('/api/webhook/venda', async (req, res) => {
  try {
    await getDatabase();
    const { plataforma, oferta_id, canal_id, valor, comissao, status, transaction_id } = req.body;
    if (!plataforma || !oferta_id || !valor) {
      return res.status(400).json({ error: 'plataforma, oferta_id e valor são obrigatórios' });
    }
    const oferta = await getOne('SELECT id FROM ofertas WHERE id = ?', [oferta_id]);
    if (!oferta) return res.status(404).json({ error: 'Oferta não encontrada' });

    await runQuery(
      `INSERT INTO vendas (oferta_id, canal_id, valor, comissao, plataforma, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [oferta_id, canal_id || null, parseFloat(valor), parseFloat(comissao) || 0, plataforma, status || 'confirmada']
    );
    await logInfo(`[Webhook] Venda registrada: oferta ${oferta_id}, ${plataforma}, R$${valor}`);
    res.json({ message: 'Venda registrada com sucesso' });
  } catch (err) {
    await logError('[Webhook] Erro ao registrar venda', err.message);
    res.status(500).json({ error: 'Erro ao registrar venda' });
  }
});

// Click tracking redirect
app.get('/go/:id', async (req, res) => {
  try {
    await getDatabase();
    const oferta = await getOne('SELECT link_afiliado, link_original FROM ofertas WHERE id = ?', [req.params.id]);
    if (oferta) {
      await runQuery('INSERT INTO cliques (oferta_id, ip, user_agent, referer) VALUES (?, ?, ?, ?)',
        [req.params.id, req.ip, req.get('user-agent'), req.get('referer')]);
      res.redirect(302, oferta.link_afiliado || oferta.link_original);
    } else {
      res.status(404).send('Oferta não encontrada');
    }
  } catch (err) {
    res.status(404).send('Oferta não encontrada');
  }
});

// Page routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'dashboard.html')));
app.get('/ofertas', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'ofertas.html')));
app.get('/telegram', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'telegram.html')));
app.get('/afiliados', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'afiliados.html')));
app.get('/analytics', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'analytics.html')));
app.get('/configuracoes', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'configuracoes.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'login.html')));
app.get('/ofertas-publicas', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'ofertas-publicas.html')));

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Start server
async function start() {
  try {
    await initializeDatabase();
    console.log('✅ Banco de dados inicializado');

    try {
      const { setConfig } = require('./utils/helpers');
      await setConfig('base_url', BASE_URL);
    } catch (e) {}

    app.listen(PORT, () => {
      console.log(`\n🚀 OFERTASLAB rodando em http://localhost:${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}/`);
      console.log(`📋 Ofertas: http://localhost:${PORT}/ofertas`);
      console.log(`📱 Telegram: http://localhost:${PORT}/telegram`);
      console.log(`🔗 Afiliados: http://localhost:${PORT}/afiliados`);
      console.log(`📈 Analytics: http://localhost:${PORT}/analytics`);
      console.log(`⚙️  Config: http://localhost:${PORT}/configuracoes`);
      console.log(`💰 Webhook: ${BASE_URL}/api/webhook/venda\n`);
      startCronJobs();
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
