import type { Request, Response } from 'express';
import { Broker } from '../models/Broker.js';
import { Stock } from '../models/Stock.js';
import { Recommendation } from '../models/Recommendation.js';
import { getRecommendationDateRange } from '../utils/recommendationDate.js';
import { addCalendarEventHints, type StockCarrier } from '../services/calendar/eventIndicator.service.js';

const readLimit = (value: unknown, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
};

async function findRecommendations(query: Request['query'], fallbackLimit: number, maximumLimit: number) {
  const filter: Record<string, unknown> = {};
  const dateRange = getRecommendationDateRange(query);
  if (dateRange) filter.recommendationDate = dateRange;
  const recommendation = String(query.recommendation || '').toUpperCase();
  if (['BUY', 'HOLD', 'SELL'].includes(recommendation)) filter.recommendation = recommendation;
  if (query.stock) {
    const stock = await Stock.findOne({ symbol: String(query.stock).toUpperCase() }).select('_id').lean();
    filter.stock = stock?._id || null;
  }
  if (query.broker) {
    const name = String(query.broker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const broker = await Broker.findOne({ name: { $regex: `^${name}$`, $options: 'i' } }).select('_id').lean();
    filter.broker = broker?._id || null;
  }

  const recommendations = await Recommendation.find(filter)
    .sort({ recommendationDate: -1 })
    .limit(readLimit(query.limit, fallbackLimit, maximumLimit))
    .populate('stock broker')
    .populate({ path: 'article', populate: { path: 'publisher' } })
    .populate({ path: 'articles', populate: { path: 'publisher' } })
    .lean();
  return addCalendarEventHints(recommendations as unknown as StockCarrier[], query.eventDate);
}

export async function listRecommendations(req: Request, res: Response) {
  res.json(await findRecommendations(req.query, 100, 200));
}

export async function latestRecommendations(req: Request, res: Response) {
  res.json(await findRecommendations(req.query, 10, 50));
}
