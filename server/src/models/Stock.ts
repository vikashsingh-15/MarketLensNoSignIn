import { Schema, model } from 'mongoose';

export const STOCK_DATA_STATUSES = ['READY', 'INSUFFICIENT_HISTORY', 'PROVIDER_UNAVAILABLE', 'TEMPORARY_ERROR'] as const;
export type StockDataStatus = typeof STOCK_DATA_STATUSES[number];

export interface IStockSymbolHistory {
  symbol: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

export interface IStock {
  symbol: string;
  companyName: string;
  exchange: string;
  aliases: string[];
  isin?: string;
  listingDate?: Date;
  active: boolean;
  lastSeenAt?: Date;
  inactiveSince?: Date;
  inactiveReason?: 'MISSING_FROM_MASTER' | 'SYMBOL_CHANGED' | 'MANUAL';
  successorSymbols: string[];
  symbolHistory: IStockSymbolHistory[];
  consecutiveMasterMisses: number;
  dataStatus: StockDataStatus;
  dataStatusReason?: string;
  dataStatusUpdatedAt?: Date;
  nextDataRetryAt?: Date;
  availableCandleCount?: number;
  requiredCandleCount?: number;
  providerSymbols: { yahoo?: string };
  lastDataError?: { provider: string; code: string; message: string; occurredAt: Date };
}

const symbolHistorySchema = new Schema<IStockSymbolHistory>({
  symbol: { type: String, required: true, uppercase: true },
  effectiveFrom: Date,
  effectiveTo: Date,
}, { _id: false });

const schema = new Schema<IStock>({
  symbol: { type: String, required: true, unique: true, uppercase: true, index: true },
  companyName: { type: String, required: true },
  exchange: { type: String, required: true, default: 'NSE' },
  aliases: { type: [String], default: [] },
  isin: { type: String, uppercase: true, trim: true },
  listingDate: Date,
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: Date,
  inactiveSince: Date,
  inactiveReason: { type: String, enum: ['MISSING_FROM_MASTER', 'SYMBOL_CHANGED', 'MANUAL'] },
  successorSymbols: { type: [String], default: [] },
  symbolHistory: { type: [symbolHistorySchema], default: [] },
  consecutiveMasterMisses: { type: Number, default: 0, min: 0 },
  dataStatus: { type: String, enum: STOCK_DATA_STATUSES, default: 'READY', index: true },
  dataStatusReason: String,
  dataStatusUpdatedAt: Date,
  nextDataRetryAt: Date,
  availableCandleCount: Number,
  requiredCandleCount: Number,
  providerSymbols: { yahoo: String },
  lastDataError: {
    provider: String,
    code: String,
    message: String,
    occurredAt: Date,
  },
});
schema.index({ isin: 1 }, { unique: true, sparse: true });
schema.index({ active: 1, nextDataRetryAt: 1 });
export const Stock = model<IStock>('Stock', schema);
