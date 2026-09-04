import type { Types } from 'mongoose';
import { Stock } from '../../models/Stock.js';
import { classifyMarketDataError } from './marketDataError.js';

const HOUR_MS = 60 * 60 * 1000;

export async function markMarketDataReady(stockId: Types.ObjectId, yahooSymbol: string) {
  await Stock.updateOne(
    { _id: stockId },
    {
      $set: {
        dataStatus: 'READY',
        dataStatusUpdatedAt: new Date(),
        'providerSymbols.yahoo': yahooSymbol,
      },
      $unset: {
        dataStatusReason: '', nextDataRetryAt: '', availableCandleCount: '', requiredCandleCount: '', lastDataError: '',
      },
    },
  );
}

export async function markInsufficientHistory(stockId: Types.ObjectId, yahooSymbol: string, available: number, required: number) {
  await Stock.updateOne(
    { _id: stockId },
    {
      $set: {
        dataStatus: 'INSUFFICIENT_HISTORY',
        dataStatusReason: `Only ${available} daily candles are available; ${required} are required`,
        dataStatusUpdatedAt: new Date(),
        nextDataRetryAt: new Date(Date.now() + 20 * HOUR_MS),
        availableCandleCount: available,
        requiredCandleCount: required,
        'providerSymbols.yahoo': yahooSymbol,
      },
      $unset: { lastDataError: '' },
    },
  );
}

export async function markMarketDataError(stockId: Types.ObjectId, error: unknown) {
  const classified = classifyMarketDataError(error);
  const occurredAt = new Date();
  await Stock.updateOne(
    { _id: stockId },
    {
      $set: {
        dataStatus: classified.code === 'SYMBOL_NOT_FOUND' ? 'PROVIDER_UNAVAILABLE' : 'TEMPORARY_ERROR',
        dataStatusReason: classified.message,
        dataStatusUpdatedAt: occurredAt,
        nextDataRetryAt: new Date(occurredAt.getTime() + classified.retryAfterMs),
        lastDataError: {
          provider: 'Yahoo Finance',
          code: classified.code,
          message: classified.message,
          occurredAt,
        },
      },
    },
  );
  return classified;
}
