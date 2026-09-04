import type { Request, Response } from 'express';
import { Stock } from '../models/Stock.js';
import { Recommendation } from '../models/Recommendation.js';
import { getStockAnalytics } from '../services/recommendation/analytics.service.js';
import { getRecommendationDateRange } from '../utils/recommendationDate.js';
import { addCalendarEventHints, type StockCarrier } from '../services/calendar/eventIndicator.service.js';
import { getAdvancedMarketData, getCoreMarketData } from '../services/market/yahooFinance.service.js';
import { getStockNewsSentiment } from '../services/news/newsSentiment.service.js';

const normalizedSymbol = (value: unknown) => String(value).trim().toUpperCase();
const activeSymbolQuery = (value: unknown) => {
  const symbol = normalizedSymbol(value);
  return { active: { $ne: false }, $or: [{ symbol }, { aliases: symbol }] };
};

export async function listStocks(_req: Request, res: Response) { res.json(await Stock.find({ active: { $ne: false } }).sort({ symbol: 1 }).lean()); }
export async function searchStocks(req: Request, res: Response) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  res.json(await Stock.find({ active: { $ne: false }, $or: [{ symbol: { $regex: pattern, $options: 'i' } }, { companyName: { $regex: pattern, $options: 'i' } }, { aliases: { $regex: pattern, $options: 'i' } }] }).limit(10).lean());
}

export async function stockDataHealth(req: Request, res: Response) {
  const requestedLimit = Number(req.query.limit);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 100, 500));
  const issueFilter = {
    $or: [
      { active: false },
      { dataStatus: { $in: ['INSUFFICIENT_HISTORY', 'PROVIDER_UNAVAILABLE', 'TEMPORARY_ERROR'] } },
    ],
  };
  const [issues, statusCounts, latestMasterRecord, activeStocks, inactiveStocks] = await Promise.all([
    Stock.find(issueFilter)
      .select('symbol companyName exchange isin active inactiveSince inactiveReason successorSymbols dataStatus dataStatusReason dataStatusUpdatedAt nextDataRetryAt availableCandleCount requiredCandleCount providerSymbols lastDataError')
      .sort({ dataStatusUpdatedAt: -1, symbol: 1 })
      .limit(limit)
      .lean(),
    Stock.aggregate<{ _id: string; count: number }>([
      { $match: { active: { $ne: false } } },
      { $group: { _id: { $ifNull: ['$dataStatus', 'READY'] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Stock.findOne({ exchange: 'NSE', lastSeenAt: { $exists: true } }).sort({ lastSeenAt: -1 }).select('lastSeenAt').lean(),
    Stock.countDocuments({ active: { $ne: false } }),
    Stock.countDocuments({ active: false }),
  ]);
  res.json({
    masterLastSeenAt: latestMasterRecord?.lastSeenAt || null,
    activeStocks,
    inactiveStocks,
    statusCounts,
    issues,
  });
}
export async function getStock(req: Request, res: Response) {
  const requested = normalizedSymbol(req.params.symbol);
  const stock = await Stock.findOne({ symbol: requested }).lean() || await Stock.findOne(activeSymbolQuery(requested)).lean();
  if (!stock) return res.status(404).json({ message: 'Stock not found' });
  const analytics = (await getStockAnalytics(stock.symbol, getRecommendationDateRange(req.query)))[0] || null;
  res.json({ stock, analytics });
}
export async function stockRecommendations(req: Request, res: Response) {
  const requested = normalizedSymbol(req.params.symbol);
  const stock = await Stock.findOne({ symbol: requested }) || await Stock.findOne(activeSymbolQuery(requested));
  if (!stock) return res.status(404).json({ message: 'Stock not found' });
  const dateRange = getRecommendationDateRange(req.query);
  const recommendations = await Recommendation.find({ stock: stock._id, ...(dateRange ? { recommendationDate: dateRange } : {}) }).sort({ recommendationDate: -1 }).populate('stock broker').populate({ path: 'article', populate: { path: 'publisher' } }).populate({ path: 'articles', populate: { path: 'publisher' } }).lean();
  res.json(await addCalendarEventHints(recommendations as unknown as StockCarrier[], req.query.eventDate));
}

export async function stockNewsSentiment(req: Request, res: Response) {
  const requestedLimit = Number(req.query.limit);
  const result = await getStockNewsSentiment(String(req.params.symbol), Number.isFinite(requestedLimit) ? requestedLimit : 30);
  if (!result) return res.status(404).json({ message: 'Stock not found' });
  res.json(result);
}

export async function stockMarketData(req: Request, res: Response) {
  const stock = await Stock.findOne(activeSymbolQuery(req.params.symbol)).lean();
  if (!stock) return res.status(404).json({ message: 'Stock not found' });
  try { res.json(await getCoreMarketData(stock)); }
  catch (error) {
    console.warn(`Yahoo Finance core data failed for ${stock.symbol}:`, error instanceof Error ? error.message : error);
    res.status(502).json({ message: `Market data is temporarily unavailable for ${stock.symbol}` });
  }
}

export async function stockAdvancedMarketData(req: Request, res: Response) {
  const stock = await Stock.findOne(activeSymbolQuery(req.params.symbol)).lean();
  if (!stock) return res.status(404).json({ message: 'Stock not found' });
  try { res.json(await getAdvancedMarketData(stock)); }
  catch (error) {
    console.warn(`Yahoo Finance advanced data failed for ${stock.symbol}:`, error instanceof Error ? error.message : error);
    res.status(502).json({ message: `Advanced market data is temporarily unavailable for ${stock.symbol}` });
  }
}
