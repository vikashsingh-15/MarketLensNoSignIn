const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type MarketDataErrorClassification = {
  code: 'SYMBOL_NOT_FOUND' | 'TRANSIENT_PROVIDER_ERROR';
  retryAfterMs: number;
  message: string;
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function classifyMarketDataError(error: unknown): MarketDataErrorClassification {
  const message = errorMessage(error).slice(0, 500);
  const normalized = message.toLowerCase();
  const symbolNotFound = normalized.includes('quote not found')
    || normalized.includes('no data found, symbol may be delisted')
    || normalized.includes('possibly delisted');
  return symbolNotFound
    ? { code: 'SYMBOL_NOT_FOUND', retryAfterMs: 24 * HOUR_MS, message }
    : { code: 'TRANSIENT_PROVIDER_ERROR', retryAfterMs: 15 * MINUTE_MS, message };
}
