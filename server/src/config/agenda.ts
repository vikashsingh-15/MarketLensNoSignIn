import { Agenda } from 'agenda';
import { env } from './env.js';
import { defineMarketNewsJob } from '../jobs/marketNews.job.js';
import { defineCorporateCalendarJob } from '../jobs/corporateCalendar.job.js';
import { defineStrategyScreenJob } from '../jobs/strategyScreen.job.js';
import { defineStockMasterJob } from '../jobs/stockMaster.job.js';

export async function startAgenda() {
  const agenda = new Agenda({ db: { address: env.mongoUri, collection: 'agendaJobs' }, processEvery: '1 minute' });
  defineMarketNewsJob(agenda);
  defineCorporateCalendarJob(agenda);
  defineStrategyScreenJob(agenda);
  defineStockMasterJob(agenda);
  await agenda.start();
  await agenda.cancel({ name: 'fetch-market-news', type: 'single' });
  await agenda.every('15 minutes', 'fetch-market-news', {}, { skipImmediate: true });
  await agenda.every('35 6 * * 1-5', 'sync-corporate-calendar', {}, { timezone: 'Asia/Kolkata' });
  await agenda.every('15 5 * * 1-5', 'sync-nse-stock-master', {}, { timezone: 'Asia/Kolkata' });
  // Replace the former schedule so existing Agenda metadata cannot retain its old next-run time.
  await agenda.cancel({ name: 'scan-strategy-screens', type: 'single' });
  await agenda.every('3 minutes', 'scan-strategy-screens', {}, { skipImmediate: true });
  if (env.rssRunOnStartup) await agenda.now('fetch-market-news', {});
  await agenda.now('sync-corporate-calendar', {});
  await agenda.now('scan-strategy-screens', {});
  console.log(`Agenda scheduler started${env.rssRunOnStartup ? ' and queued an immediate RSS run' : ''}; news scans every 15 minutes; queued BSE calendar and strategy syncs; NSE master syncs every weekday; strategy screens continue every 3 minutes`);
  return agenda;
}
