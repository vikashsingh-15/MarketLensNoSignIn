import type { Agenda } from 'agenda';
import { runStrategyScreenScan } from '../services/strategy/strategyScreen.service.js';

export function defineStrategyScreenJob(agenda: Agenda) {
  agenda.define('scan-strategy-screens', async () => {
    const summary = await runStrategyScreenScan({ limit: 100 });
    if (summary.requested || summary.errors.length) console.log('Strategy screen summary:', summary);
  });
}
