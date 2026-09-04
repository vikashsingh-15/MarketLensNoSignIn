import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { fetchMarketNews } from '../services/rss/rss.service.js';

async function run() {
  await connectDatabase();
  console.log('Starting live RSS ingestion...');
  const summary = await fetchMarketNews();
  console.log('Live RSS ingestion completed:', summary);
  await mongoose.disconnect();
}

run().catch(async (error) => { console.error('Live RSS ingestion failed:', error); await mongoose.disconnect(); process.exit(1); });
