import type { Agenda } from 'agenda';
import { syncNseStocks } from '../services/stock/nseStock.service.js';

export function defineStockMasterJob(agenda: Agenda) {
  agenda.define('sync-nse-stock-master', async () => {
    try {
      const summary = await syncNseStocks();
      console.log('Official NSE stock master sync:', summary);
    } catch (error) {
      console.warn('NSE stock master sync failed; the last validated master remains active.', error);
    }
  });
}
