import type { Agenda } from 'agenda';
import { fetchMarketNews } from '../services/rss/rss.service.js';

export function defineMarketNewsJob(agenda: Agenda) {
  agenda.define('fetch-market-news', async () => { await fetchMarketNews(); });
}
