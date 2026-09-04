import { Schema, model } from 'mongoose';

export const MARKET_DATA_CACHE_KINDS = ['QUOTE', 'DAILY_CHART', 'FUNDAMENTALS', 'FINANCIAL_HISTORY', 'ADVANCED'] as const;
export type MarketDataCacheKind = typeof MARKET_DATA_CACHE_KINDS[number];

export interface IMarketDataCache {
  key: string;
  symbol: string;
  exchange: string;
  kind: MarketDataCacheKind;
  data: Record<string, unknown>;
  fetchedAt: Date;
  expiresAt: Date;
  lastError?: string;
  lastErrorAt?: Date;
}

const schema = new Schema<IMarketDataCache>({
  key: { type: String, required: true, unique: true, index: true },
  symbol: { type: String, required: true, uppercase: true, index: true },
  exchange: { type: String, required: true, uppercase: true },
  kind: { type: String, enum: MARKET_DATA_CACHE_KINDS, required: true, index: true },
  data: { type: Schema.Types.Mixed, required: true },
  fetchedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: true },
  lastError: String,
  lastErrorAt: Date,
}, { timestamps: true });
schema.index({ symbol: 1, exchange: 1, kind: 1 });
export const MarketDataCache = model<IMarketDataCache>('MarketDataCache', schema);
