import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { syncBseCalendar } from '../services/calendar/bseCalendar.service.js';
import { syncYahooCalendar } from '../services/calendar/yahooCalendar.service.js';
import { syncNseCalendar } from '../services/calendar/nseCalendar.service.js';

async function run() {
  await connectDatabase();
  console.log('Starting corporate calendar ingestion...');
  const [bse, yahoo, nse] = await Promise.all([syncBseCalendar(), syncYahooCalendar(), syncNseCalendar()]);
  console.log('BSE corporate calendar ingestion completed:', bse);
  console.log('Yahoo Finance corporate calendar ingestion completed:', yahoo);
  console.log('NSE corporate actions ingestion completed:', nse);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('BSE corporate calendar ingestion failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
