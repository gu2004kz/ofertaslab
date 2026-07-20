const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function getDatabase() {
  getPool();
}

function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

function convertDateFunctions(sql) {
  return sql
    .replace(/date\('now',\s*'start of month'\)/g, "date_trunc('month', CURRENT_DATE)")
    .replace(/date\('now',\s*'-(\d+) days'\)/g, "(CURRENT_DATE - INTERVAL '$1 days')")
    .replace(/date\('now'\)/g, 'CURRENT_DATE')
    .replace(/datetime\('now',\s*'-(\d+) days'\)/g, "(NOW() - INTERVAL '$1 days')")
    .replace(/datetime\('now'\)/g, 'NOW()');
}

function prepareSql(sql, params = []) {
  let converted = convertPlaceholders(sql);
  converted = convertDateFunctions(converted);
  return { text: converted, values: params };
}

async function runQuery(sql, params = []) {
  try {
    const client = getPool();
    const prepared = prepareSql(sql, params);
    const isInsert = /^\s*INSERT/i.test(sql);
    if (isInsert && !/RETURNING/i.test(sql)) {
      prepared.text += ' RETURNING id';
      const result = await client.query(prepared);
      return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
    }
    const result = await client.query(prepared);
    return { changes: result.rowCount, lastInsertRowid: null };
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

async function getOne(sql, params = []) {
  try {
    const client = getPool();
    const prepared = prepareSql(sql, params);
    const result = await client.query(prepared);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

async function getAll(sql, params = []) {
  try {
    const client = getPool();
    const prepared = prepareSql(sql, params);
    const result = await client.query(prepared);
    return result.rows;
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

async function initializeDatabase() {
  await getDatabase();
  const client = getPool();

  await client.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS categorias (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icone TEXT DEFAULT '📦',
    ativa INTEGER DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS afiliados (
    id SERIAL PRIMARY KEY,
    plataforma TEXT NOT NULL,
    conta TEXT NOT NULL,
    affiliate_id TEXT,
    api_key TEXT,
    api_secret TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expira_em TIMESTAMP,
    ativo INTEGER DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS ofertas (
    id SERIAL PRIMARY KEY,
    produto TEXT NOT NULL,
    descricao TEXT,
    preco_antigo REAL,
    preco_novo REAL,
    desconto REAL DEFAULT 0,
    link_original TEXT NOT NULL,
    link_afiliado TEXT,
    imagem TEXT,
    categoria_id INTEGER,
    plataforma TEXT NOT NULL,
    loja TEXT,
    avaliacoes REAL DEFAULT 0,
    vendidos INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pendente',
    fonte TEXT,
    palavras_chave TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    publicada_em TIMESTAMP,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS historico_precos (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL,
    preco REAL NOT NULL,
    registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id) ON DELETE CASCADE
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS telegram_canais (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    canal_id TEXT NOT NULL,
    bot_token TEXT NOT NULL,
    ativo INTEGER DEFAULT 1,
    horario_inicio TEXT DEFAULT '08:00',
    horario_fim TEXT DEFAULT '23:00',
    intervalo_minutos INTEGER DEFAULT 15,
    limite_diario INTEGER DEFAULT 50,
    mensagens_enviadas_hoje INTEGER DEFAULT 0,
    ultimo_envio TIMESTAMP,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS publicacoes (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL,
    canal_id INTEGER NOT NULL,
    mensagem_id TEXT,
    status TEXT DEFAULT 'enviada',
    enviada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id),
    FOREIGN KEY (canal_id) REFERENCES telegram_canais(id)
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS cliques (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL,
    canal_id INTEGER,
    ip TEXT,
    user_agent TEXT,
    referer TEXT,
    clicado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id),
    FOREIGN KEY (canal_id) REFERENCES telegram_canais(id)
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS vendas (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL,
    canal_id INTEGER,
    valor REAL NOT NULL,
    comissao REAL DEFAULT 0,
    plataforma TEXT,
    status TEXT DEFAULT 'pendente',
    registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id),
    FOREIGN KEY (canal_id) REFERENCES telegram_canais(id)
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS configuracoes (
    id SERIAL PRIMARY KEY,
    chave TEXT UNIQUE NOT NULL,
    valor TEXT,
    descricao TEXT,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    nivel TEXT DEFAULT 'info',
    mensagem TEXT NOT NULL,
    detalhes TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS whatsapp_canais (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    session_data TEXT,
    ativo INTEGER DEFAULT 1,
    horario_inicio TEXT DEFAULT '08:00',
    horario_fim TEXT DEFAULT '23:00',
    intervalo_minutos INTEGER DEFAULT 15,
    limite_diario INTEGER DEFAULT 50,
    mensagens_enviadas_hoje INTEGER DEFAULT 0,
    ultimo_envio TIMESTAMP,
    conectado INTEGER DEFAULT 0,
    qr_code TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS whatsapp_publicacoes (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL,
    canal_id INTEGER NOT NULL,
    mensagem_id TEXT,
    status TEXT DEFAULT 'enviada',
    enviada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id),
    FOREIGN KEY (canal_id) REFERENCES whatsapp_canais(id)
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS campanhas (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    descricao TEXT,
    desconto_minimo REAL DEFAULT 10,
    preco_minimo REAL DEFAULT 0,
    preco_maximo REAL DEFAULT 999999,
    categorias TEXT,
    palavras_chave TEXT,
    ativa INTEGER DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await seedDefaultData();
}

async function seedDefaultData() {
  const configCount = await getOne('SELECT COUNT(*) as count FROM configuracoes');
  if (parseInt(configCount.count) === 0) {
    const configs = [
      ['modo_publicacao', 'automatico', 'Modo de publicação: automatico ou manual'],
      ['desconto_minimo', '10', 'Desconto mínimo para capturar ofertas'],
      ['preco_minimo', '5', 'Preço mínimo dos produtos'],
      ['preco_maximo', '5000', 'Preço máximo dos produtos'],
      ['intervalo_busca', '5', 'Intervalo de busca em minutos'],
      ['limite_diario', '50', 'Limite diário de publicações por canal'],
      ['shopee_affiliate_id', '', 'ID de afiliado Shopee'],
      ['shopee_api_key', '', 'Chave da API Shopee'],
      ['shopee_api_secret', '', 'Secret da API Shopee'],
      ['ml_affiliate_id', '', 'ID de afiliado Mercado Livre'],
      ['ml_app_id', '', 'App ID Mercado Livre'],
      ['ml_secret_key', '', 'Secret Key Mercado Livre'],
      ['notificacoes_ativas', 'true', 'Notificações em tempo real ativas'],
      ['backup_automatico', 'true', 'Backup automático do banco'],
      ['tema', 'dark', 'Tema da interface'],
      ['base_url', 'http://localhost:3000', 'URL base para links de rastreamento'],
    ];
    for (const c of configs) {
      await runQuery('INSERT INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?)', c);
    }
  }

  const catCount = await getOne('SELECT COUNT(*) as count FROM categorias');
  if (parseInt(catCount.count) === 0) {
    const categorias = [
      ['Eletrônicos', 'eletronicos', '💻'],
      ['Celulares', 'celulares', '📱'],
      ['Perfumes', 'perfumes', '🧴'],
      ['Casa', 'casa', '🏠'],
      ['Beleza', 'beleza', '💄'],
      ['Games', 'games', '🎮'],
      ['Esportes', 'esportes', '⚽'],
      ['Moda', 'moda', '👗'],
      ['Infantil', 'infantil', '👶'],
      ['Pet', 'pet', '🐾'],
      ['Automotivo', 'automotivo', '🚗'],
      ['Ferramentas', 'ferramentas', '🔧'],
      ['Livros', 'livros', '📚'],
      ['Alimentos', 'alimentos', '🍔'],
      ['Teclados', 'teclados', '⌨️'],
    ];
    for (const c of categorias) {
      await runQuery('INSERT INTO categorias (nome, slug, icone) VALUES (?, ?, ?)', c);
    }
  }

  const userCount = await getOne('SELECT COUNT(*) as count FROM usuarios');
  if (parseInt(userCount.count) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await runQuery('INSERT INTO usuarios (nome, email, senha, role) VALUES (?, ?, ?, ?)', ['Administrador', 'admin@ofertaslab.com', hash, 'admin']);
  }
}

module.exports = { getDatabase, initializeDatabase, runQuery, getOne, getAll };
