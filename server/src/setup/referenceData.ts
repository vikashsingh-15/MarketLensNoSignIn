import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { ensureReferenceData } from '../services/reference/referenceData.service.js';

async function initializeReferenceData() {
  await connectDatabase();
  const result = await ensureReferenceData();
  console.log(`Initialized ${result.stocks} stocks, ${result.brokers} brokers and ${result.publishers} live RSS publishers.`);
  await mongoose.disconnect();
}

initializeReferenceData().catch(async (error) => { console.error('Reference-data initialization failed:', error); await mongoose.disconnect(); process.exit(1); });
