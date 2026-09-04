import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { Stock } from '../models/Stock.js';
import { syncNseStocks } from '../services/stock/nseStock.service.js';

try {
  await connectDatabase();
  const summary = await syncNseStocks();
  console.log('Official NSE stock master sync:', summary);
  const requestedSymbols = process.argv.slice(2).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  if (requestedSymbols.length) {
    const matches = await Stock.find({ $or: [{ symbol: { $in: requestedSymbols } }, { aliases: { $in: requestedSymbols } }] })
      .select('symbol companyName exchange isin active inactiveReason successorSymbols aliases symbolHistory lastSeenAt dataStatus dataStatusReason')
      .sort({ active: -1, symbol: 1 })
      .lean();
    console.log('Requested stock resolution:', JSON.stringify(matches, null, 2));
  }
  await mongoose.disconnect();
} catch (error) {
  console.error('NSE stock master sync failed:', error);
  await mongoose.disconnect();
  process.exit(1);
}
