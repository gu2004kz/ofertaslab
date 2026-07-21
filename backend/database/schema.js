const bcrypt = require('bcryptjs');
const path = require('path');

let pool;
let db;
let使用SQLite = false;

function getDatabase() {
  if (process.env.DATABASE_URL) {
    if (!pool) {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
    }
    return pool;
  } else {
    if (!db) {
      const Database = require('better-sqlite3');
      const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'database.sqlite');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      使用SQLite = true;
    }
    return db;
  }
}

function isPostgres() {
  return !!process.env.DATABASE_URL;
}

function convertPlaceholders(sql) {
  if (isPostgres()) {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
  }
  return sql;
}

function runQuery(sql, params = []) {
  try {
    const client = getDatabase();

    if (isPostgres()) {
      const converted = convertPlaceholders(sql);
      const isInsert = /^\s*INSERT/i.test(sql);
      if (isInsert && !/RETURNING/i.test(sql)) {
        converted += ' RETURNING id';
      }
      const result = client.query(converted, params);
      if (isInsert) {
        return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
      }
      return { changes: result.rowCount, lastInsertRowid: null };
    } else {
      const isInsert = /^\s*INSERT/i.test(sql);
      if (isInsert) {
        const result = client.prepare(sql).run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
      const result = client.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: null };
    }
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

function getOne(sql, params = []) {
  try {
    const client = getDatabase();

    if (isPostgres()) {
      const converted = convertPlaceholders(sql);
      return client.query(converted, params).then(r => r.rows[0] || null);
    } else {
      return client.prepare(sql).get(...params) || null;
    }
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

function getAll(sql, params = []) {
  try {
    const client = getDatabase();

    if (isPostgres()) {
      const converted = convertPlaceholders(sql);
      return client.query(converted, params).then(r => r.rows);
    } else {
      return client.prepare(sql).all(...params);
    }
  } catch (err) {
    console.error('[DB Error]', err.message);
    throw err;
  }
}

function initializeDatabase() {
  const client = getDatabase();

  if (isPostgres()) {
    return initPostgres(client);
  } else {
    return initSqlite(client);
  }
}

function initPostgres(client) {
  return client.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL,
    role TEXT DEFAULT 'admin', criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`).then(() => client.query(`CREATE TABLE IF NOT EXISTS categorias (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, icone TEXT DEFAULT '📦',
    ativa INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS afiliados (
    id SERIAL PRIMARY KEY, plataforma TEXT NOT NULL, conta TEXT NOT NULL, affiliate_id TEXT, api_key TEXT,
    api_secret TEXT, access_token TEXT, refresh_token TEXT, token_expira_em TIMESTAMP,
    ativo INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS ofertas (
    id SERIAL PRIMARY KEY, produto TEXT NOT NULL, descricao TEXT, preco_antigo REAL, preco_novo REAL,
    desconto REAL DEFAULT 0, link_original TEXT NOT NULL, link_afiliado TEXT, imagem TEXT, categoria_id INTEGER,
    plataforma TEXT NOT NULL, loja TEXT, avaliacoes REAL DEFAULT 0, vendidos INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pendente', fonte TEXT, palavras_chave TEXT, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, publicada_em TIMESTAMP, FOREIGN KEY (categoria_id) REFERENCES categorias(id)
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS historico_precos (
    id SERIAL PRIMARY KEY, oferta_id INTEGER NOT NULL, preco REAL NOT NULL,
    registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (oferta_id) REFERENCES ofertas(id) ON DELETE CASCADE
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS telegram_canais (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, canal_id TEXT NOT NULL, bot_token TEXT NOT NULL,
    ativo INTEGER DEFAULT 1, horario_inicio TEXT DEFAULT '08:00', horario_fim TEXT DEFAULT '23:00',
    intervalo_minutos INTEGER DEFAULT 15, limite_diario INTEGER DEFAULT 50, mensagens_enviadas_hoje INTEGER DEFAULT 0,
    ultimo_envio TIMESTAMP, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS publicacoes (
    id SERIAL PRIMARY KEY, oferta_id INTEGER NOT NULL, canal_id INTEGER NOT NULL, mensagem_id TEXT,
    status TEXT DEFAULT 'enviada', enviada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES telegram_canais(id)
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS cliques (
    id SERIAL PRIMARY KEY, oferta_id INTEGER NOT NULL, canal_id INTEGER, ip TEXT, user_agent TEXT,
    referer TEXT, clicado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES telegram_canais(id)
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS vendas (
    id SERIAL PRIMARY KEY, oferta_id INTEGER NOT NULL, canal_id INTEGER, valor REAL NOT NULL,
    comissao REAL DEFAULT 0, plataforma TEXT, status TEXT DEFAULT 'pendente',
    registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES telegram_canais(id)
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS configuracoes (
    id SERIAL PRIMARY KEY, chave TEXT UNIQUE NOT NULL, valor TEXT, descricao TEXT,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY, nivel TEXT DEFAULT 'info', mensagem TEXT NOT NULL, detalhes TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS whatsapp_canais (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, chat_id TEXT NOT NULL, session_data TEXT,
    ativo INTEGER DEFAULT 1, horario_inicio TEXT DEFAULT '08:00', horario_fim TEXT DEFAULT '23:00',
    intervalo_minutos INTEGER DEFAULT 15, limite_diario INTEGER DEFAULT 50, mensagens_enviadas_hoje INTEGER DEFAULT 0,
    ultimo_envio TIMESTAMP, conectado INTEGER DEFAULT 0, qr_code TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS whatsapp_publicacoes (
    id SERIAL PRIMARY KEY, oferta_id INTEGER NOT NULL, canal_id INTEGER NOT NULL, mensagem_id TEXT,
    status TEXT DEFAULT 'enviada', enviada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES whatsapp_canais(id)
  )`)).then(() => client.query(`CREATE TABLE IF NOT EXISTS campanhas (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, desconto_minimo REAL DEFAULT 10,
    preco_minimo REAL DEFAULT 0, preco_maximo REAL DEFAULT 999999, categorias TEXT,
    palavras_chave TEXT, ativa INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)).then(() => seedDefaultDataPostgres(client));
}

function seedDefaultDataPostgres(client) {
  return client.query("SELECT COUNT(*) as count FROM configuracoes").then(r => {
    if (parseInt(r.rows[0].count) === 0) {
      const configs = [
        ['modo_publicacao', 'automatico'], ['desconto_minimo', '10'], ['preco_minimo', '5'],
        ['preco_maximo', '5000'], ['intervalo_busca', '5'], ['limite_diario', '50'],
        ['shopee_affiliate_id', ''], ['shopee_api_key', ''], ['shopee_api_secret', ''],
        ['ml_matt_word', ''], ['ml_matt_tool', ''],
        ['ml_app_id', ''], ['ml_secret_key', ''],
        ['notificacoes_ativas', 'true'], ['backup_automatico', 'true'],
        ['tema', 'dark'], ['base_url', 'http://localhost:3000'],
      ];
      const promises = configs.map(c => client.query('INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)', c));
      return Promise.all(promises);
    }
  }).then(() => client.query("SELECT COUNT(*) as count FROM categorias")).then(r => {
    if (parseInt(r.rows[0].count) === 0) {
      const cats = [
        ['Eletrônicos', 'eletronicos', '💻'], ['Celulares', 'celulares', '📱'],
        ['Perfumes', 'perfumes', '🧴'], ['Casa', 'casa', '🏠'], ['Beleza', 'beleza', '💄'],
        ['Games', 'games', '🎮'], ['Esportes', 'esportes', '⚽'], ['Moda', 'moda', '👗'],
        ['Infantil', 'infantil', '👶'], ['Pet', 'pet', '🐾'], ['Automotivo', 'automotivo', '🚗'],
        ['Ferramentas', 'ferramentas', '🔧'], ['Livros', 'livros', '📚'],
        ['Alimentos', 'alimentos', '🍔'], ['Teclados', 'teclados', '⌨️'],
      ];
      const promises = cats.map(c => client.query('INSERT INTO categorias (nome, slug, icone) VALUES ($1, $2, $3)', c));
      return Promise.all(promises);
    }
  }).then(() => client.query("SELECT COUNT(*) as count FROM usuarios")).then(r => {
    if (parseInt(r.rows[0].count) === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      return client.query('INSERT INTO usuarios (nome, email, senha, role) VALUES ($1, $2, $3, $4)',
        ['Administrador', 'admin@ofertaslab.com', hash, 'admin']);
    }
  });
}

function initSqlite(client) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, role TEXT DEFAULT 'admin', criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, icone TEXT DEFAULT '📦', ativa INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS afiliados (id INTEGER PRIMARY KEY AUTOINCREMENT, plataforma TEXT NOT NULL, conta TEXT NOT NULL, affiliate_id TEXT, api_key TEXT, api_secret TEXT, access_token TEXT, refresh_token TEXT, token_expira_em DATETIME, ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS ofertas (id INTEGER PRIMARY KEY AUTOINCREMENT, produto TEXT NOT NULL, descricao TEXT, preco_antigo REAL, preco_novo REAL, desconto REAL DEFAULT 0, link_original TEXT NOT NULL, link_afiliado TEXT, imagem TEXT, categoria_id INTEGER, plataforma TEXT NOT NULL, loja TEXT, avaliacoes REAL DEFAULT 0, vendidos INTEGER DEFAULT 0, status TEXT DEFAULT 'pendente', fonte TEXT, palavras_chave TEXT, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP, publicada_em DATETIME, FOREIGN KEY (categoria_id) REFERENCES categorias(id))`,
    `CREATE TABLE IF NOT EXISTS historico_precos (id INTEGER PRIMARY KEY AUTOINCREMENT, oferta_id INTEGER NOT NULL, preco REAL NOT NULL, registrado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (oferta_id) REFERENCES ofertas(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS telegram_canais (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, canal_id TEXT NOT NULL, bot_token TEXT NOT NULL, ativo INTEGER DEFAULT 1, horario_inicio TEXT DEFAULT '08:00', horario_fim TEXT DEFAULT '23:00', intervalo_minutos INTEGER DEFAULT 15, limite_diario INTEGER DEFAULT 50, mensagens_enviadas_hoje INTEGER DEFAULT 0, ultimo_envio DATETIME, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS publicacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, oferta_id INTEGER NOT NULL, canal_id INTEGER NOT NULL, mensagem_id TEXT, status TEXT DEFAULT 'enviada', enviada_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES telegram_canais(id))`,
    `CREATE TABLE IF NOT EXISTS cliques (id INTEGER PRIMARY KEY AUTOINCREMENT, oferta_id INTEGER NOT NULL, canal_id INTEGER, ip TEXT, user_agent TEXT, referer TEXT, clicado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES telegram_canais(id))`,
    `CREATE TABLE IF NOT EXISTS vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, oferta_id INTEGER NOT NULL, canal_id INTEGER, valor REAL NOT NULL, comissao REAL DEFAULT 0, plataforma TEXT, status TEXT DEFAULT 'pendente', registrado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES telegram_canais(id))`,
    `CREATE TABLE IF NOT EXISTS configuracoes (id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE NOT NULL, valor TEXT, descricao TEXT, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, nivel TEXT DEFAULT 'info', mensagem TEXT NOT NULL, detalhes TEXT, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS whatsapp_canais (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, chat_id TEXT NOT NULL, session_data TEXT, ativo INTEGER DEFAULT 1, horario_inicio TEXT DEFAULT '08:00', horario_fim TEXT DEFAULT '23:00', intervalo_minutos INTEGER DEFAULT 15, limite_diario INTEGER DEFAULT 50, mensagens_enviadas_hoje INTEGER DEFAULT 0, ultimo_envio DATETIME, conectado INTEGER DEFAULT 0, qr_code TEXT, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS whatsapp_publicacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, oferta_id INTEGER NOT NULL, canal_id INTEGER NOT NULL, mensagem_id TEXT, status TEXT DEFAULT 'enviada', enviada_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (oferta_id) REFERENCES ofertas(id), FOREIGN KEY (canal_id) REFERENCES whatsapp_canais(id))`,
    `CREATE TABLE IF NOT EXISTS campanhas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, descricao TEXT, desconto_minimo REAL DEFAULT 10, preco_minimo REAL DEFAULT 0, preco_maximo REAL DEFAULT 999999, categorias TEXT, palavras_chave TEXT, ativa INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
  ];

  const createAll = client.transaction(() => {
    for (const sql of tables) client.exec(sql);
  });
  createAll();

  seedDefaultDataSqlite(client);
}

function seedDefaultDataSqlite(client) {
  const configCount = client.prepare('SELECT COUNT(*) as count FROM configuracoes').get();
  if (parseInt(configCount.count) === 0) {
    const insert = client.prepare('INSERT INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?)');
    const configs = [
      ['modo_publicacao', 'automatico', 'Modo de publicacao'], ['desconto_minimo', '10', 'Desconto minimo'],
      ['preco_minimo', '5', 'Preco minimo'], ['preco_maximo', '5000', 'Preco maximo'],
      ['intervalo_busca', '5', 'Intervalo de busca'], ['limite_diario', '50', 'Limite diario'],
      ['shopee_affiliate_id', '', 'Affiliate ID Shopee'], ['shopee_api_key', '', 'API Key Shopee'],
      ['shopee_api_secret', '', 'API Secret Shopee'],       ['ml_matt_word', '', 'Username ML Afiliados'],
      ['ml_matt_tool', '', 'Tool ID ML Afiliados'], ['ml_app_id', '', 'App ID ML API'],
      ['ml_secret_key', '', 'Secret Key ML API'], ['notificacoes_ativas', 'true', 'Notificacoes'],
      ['backup_automatico', 'true', 'Backup automatico'], ['tema', 'dark', 'Tema'],
      ['base_url', 'http://localhost:3000', 'URL base'],
    ];
    const insertMany = client.transaction((items) => {
      for (const c of items) insert.run(c[0], c[1], c[2]);
    });
    insertMany(configs);
  }

  const catCount = client.prepare('SELECT COUNT(*) as count FROM categorias').get();
  if (parseInt(catCount.count) === 0) {
    const insert = client.prepare('INSERT INTO categorias (nome, slug, icone) VALUES (?, ?, ?)');
    const cats = [
      ['Eletronicos', 'eletronicos', '💻'], ['Celulares', 'celulares', '📱'],
      ['Perfumes', 'perfumes', '🧴'], ['Casa', 'casa', '🏠'], ['Beleza', 'beleza', '💄'],
      ['Games', 'games', '🎮'], ['Esportes', 'esportes', '⚽'], ['Moda', 'moda', '👗'],
      ['Infantil', 'infantil', '👶'], ['Pet', 'pet', '🐾'], ['Automotivo', 'automotivo', '🚗'],
      ['Ferramentas', 'ferramentas', '🔧'], ['Livros', 'livros', '📚'],
      ['Alimentos', 'alimentos', '🍔'], ['Teclados', 'teclados', '⌨️'],
    ];
    const insertMany = client.transaction((items) => {
      for (const c of items) insert.run(c[0], c[1], c[2]);
    });
    insertMany(cats);
  }

  const userCount = client.prepare('SELECT COUNT(*) as count FROM usuarios').get();
  if (parseInt(userCount.count) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    client.prepare('INSERT INTO usuarios (nome, email, senha, role) VALUES (?, ?, ?, ?)').run('Administrador', 'admin@ofertaslab.com', hash, 'admin');
  }
}

module.exports = { getDatabase, initializeDatabase, runQuery, getOne, getAll };
