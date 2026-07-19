const { getDatabase, getOne, getAll, runQuery } = require('../database/schema');

async function logInfo(mensagem, detalhes = null) {
  try { await runQuery('INSERT INTO logs (nivel, mensagem, detalhes) VALUES (?, ?, ?)', ['info', mensagem, detalhes]); } catch (e) {}
}

async function logWarn(mensagem, detalhes = null) {
  try { await runQuery('INSERT INTO logs (nivel, mensagem, detalhes) VALUES (?, ?, ?)', ['warn', mensagem, detalhes]); } catch (e) {}
}

async function logError(mensagem, detalhes = null) {
  try { await runQuery('INSERT INTO logs (nivel, mensagem, detalhes) VALUES (?, ?, ?)', ['error', mensagem, detalhes]); } catch (e) {}
}

async function getLogs(limite = 100) {
  return await getAll('SELECT * FROM logs ORDER BY criado_em DESC LIMIT ?', [limite]);
}

async function getConfig(chave) {
  const row = await getOne('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
  return row ? row.valor : null;
}

async function setConfig(chave, valor) {
  const existing = await getOne('SELECT id FROM configuracoes WHERE chave = ?', [chave]);
  if (existing) {
    await runQuery('UPDATE configuracoes SET valor = ?, atualizado_em = CURRENT_TIMESTAMP WHERE chave = ?', [valor, chave]);
  } else {
    await runQuery('INSERT INTO configuracoes (chave, valor) VALUES (?, ?)', [chave, valor]);
  }
}

async function getAllConfigs() {
  return await getAll('SELECT * FROM configuracoes ORDER BY id');
}

module.exports = { logInfo, logWarn, logError, getLogs, getConfig, setConfig, getAllConfigs };
