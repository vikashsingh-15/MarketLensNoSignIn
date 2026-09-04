import type { IStock } from '../../models/Stock.js';
import { MarketDataCache, type MarketDataCacheKind } from '../../models/MarketDataCache.js';

export const MARKET_DATA_TTL = {
  QUOTE: 60 * 60 * 1000,
  DAILY_CHART: 60 * 60 * 1000,
  FUNDAMENTALS: 24 * 60 * 60 * 1000,
  FINANCIAL_HISTORY: 24 * 60 * 60 * 1000,
  ADVANCED: 24 * 60 * 60 * 1000,
} satisfies Record<MarketDataCacheKind, number>;

export type CacheStatus = 'HIT' | 'REFRESHED' | 'STALE_FALLBACK';
export type CacheMetadata = { status: CacheStatus; fetchedAt: string; expiresAt: string; stale: boolean };

const refreshes = new Map<string, Promise<Record<string, unknown>>>();
const cacheKey = (stock: Pick<IStock, 'symbol' | 'exchange'>, kind: MarketDataCacheKind) => `${stock.exchange}:${stock.symbol}:${kind}`.toUpperCase();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function withMetadata<T extends Record<string, unknown>>(data: T, status: CacheStatus, fetchedAt: Date, expiresAt: Date) {
  return { ...data, cache: { status, fetchedAt: fetchedAt.toISOString(), expiresAt: expiresAt.toISOString(), stale: status === 'STALE_FALLBACK' } satisfies CacheMetadata };
}

export async function databaseFirstMarketData<T extends Record<string, unknown>>(
  stock: Pick<IStock, 'symbol' | 'exchange'>,
  kind: MarketDataCacheKind,
  load: () => Promise<T>,
  maxStaleMs: number,
): Promise<T & { cache: CacheMetadata }> {
  const key = cacheKey(stock, kind);
  const existing = await MarketDataCache.findOne({ key }).lean();
  const now = new Date();
  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    return withMetadata(existing.data as T, 'HIT', existing.fetchedAt, existing.expiresAt);
  }

  try {
    let refresh = refreshes.get(key) as Promise<T> | undefined;
    if (!refresh) {
      refresh = load();
      refreshes.set(key, refresh);
    }
    const data = await refresh;
    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + MARKET_DATA_TTL[kind]);
    await MarketDataCache.updateOne({ key }, {
      $set: { key, symbol: stock.symbol, exchange: stock.exchange, kind, data, fetchedAt, expiresAt },
      $unset: { lastError: 1, lastErrorAt: 1 },
    }, { upsert: true });
    return withMetadata(data, 'REFRESHED', fetchedAt, expiresAt);
  } catch (error) {
    await MarketDataCache.updateOne({ key }, { $set: { lastError: errorMessage(error), lastErrorAt: now } });
    if (existing && now.getTime() - existing.fetchedAt.getTime() <= maxStaleMs) {
      console.warn(`Yahoo Finance refresh failed for ${key}; serving stale database cache: ${errorMessage(error)}`);
      return withMetadata(existing.data as T, 'STALE_FALLBACK', existing.fetchedAt, existing.expiresAt);
    }
    throw error;
  } finally {
    refreshes.delete(key);
  }
}
