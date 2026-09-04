import { app } from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { startAgenda } from './config/agenda.js';
import { ensureReferenceData } from './services/reference/referenceData.service.js';
import { syncNseStocks } from './services/stock/nseStock.service.js';

async function bootstrap() {
  try {
    await connectDatabase();
    const referenceData = await ensureReferenceData();
    console.log(`Reference configuration ready: ${referenceData.stocks} stocks, ${referenceData.brokers} brokers, ${referenceData.publishers} RSS publishers`);
    try {
      const stockSync = await syncNseStocks();
      console.log('Official NSE stock master synchronized:', stockSync);
    }
    catch (error) { console.warn('NSE stock master sync failed; continuing with existing stocks.', error); }
    const server = app.listen(env.port, () => console.log(`MarketLens API running at http://localhost:${env.port}`));
    const agenda = await startAgenda();
    const shutdown = async () => { await agenda.stop(); server.close(() => process.exit(0)); };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (error) { console.error('Server startup failed:', error); process.exit(1); }
}
bootstrap();
