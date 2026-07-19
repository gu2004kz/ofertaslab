const cron = require('node-cron');
const { getDatabase, getOne } = require('../database/schema');
const { logInfo } = require('../utils/helpers');
const dealCapture = require('../services/capture');
const publisher = require('../services/publisher');

async function startCronJobs() {
  await getDatabase();
  const intervaloConfig = await getOne("SELECT valor FROM configuracoes WHERE chave = 'intervalo_busca'");
  const intervalo = parseInt(intervaloConfig?.valor) || 5;

  // Captura de ofertas
  cron.schedule(`*/${intervalo} * * * *`, async () => {
    try {
      await logInfo(`[CRON] Executando captura de ofertas (intervalo: ${intervalo}min)`);
      await dealCapture.captureAll();
    } catch (err) {
      await logInfo(`[CRON] Erro na captura: ${err.message}`);
    }
  });

  // Verificação de queda de preços
  cron.schedule('0 */2 * * *', async () => {
    try {
      await logInfo('[CRON] Verificando quedas de preço...');
      await dealCapture.checkPriceDrops();
    } catch (err) {
      await logInfo(`[CRON] Erro na verificação: ${err.message}`);
    }
  });

  // Publicação no Telegram
  cron.schedule('*/3 * * * *', async () => {
    try {
      await logInfo('[CRON] Verificando ofertas para publicar...');
      await publisher.publishPendingOffers();
    } catch (err) {
      await logInfo(`[CRON] Erro na publicação: ${err.message}`);
    }
  });

  // Reset de contadores diários
  cron.schedule('0 0 * * *', async () => {
    await publisher.resetDailyCounts();
    await logInfo('[CRON] Contadores diários resetados');
  });

  // Expirar ofertas antigas (todo dia às 3h)
  cron.schedule('0 3 * * *', async () => {
    try {
      await logInfo('[CRON] Expirando ofertas antigas...');
      await dealCapture.expireOldOffers();
    } catch (err) {
      await logInfo(`[CRON] Erro ao expirar ofertas: ${err.message}`);
    }
  });

  await logInfo(`[CRON] Jobs agendados - Captura: a cada ${intervalo}min, Publicação: a cada 3min, Expiração: diária às 03h`);
}

module.exports = { startCronJobs };
