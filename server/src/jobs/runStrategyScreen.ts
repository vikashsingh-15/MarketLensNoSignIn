import { connectDatabase } from '../config/db.js';
import { runStrategyScreenScan } from '../services/strategy/strategyScreen.service.js';

await connectDatabase();
const requested = Number(process.argv[2]);
const summary = await runStrategyScreenScan({ limit: Number.isFinite(requested) ? requested : 20 });
console.log('Strategy screen summary:', summary);
process.exit(summary.errors.length ? 1 : 0);
