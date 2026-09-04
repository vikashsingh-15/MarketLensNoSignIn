import type { Request, Response } from 'express';
import { Recommendation } from '../models/Recommendation.js';
import { Stock } from '../models/Stock.js';
import { getRecommendationMarketMood, getStockAnalytics } from '../services/recommendation/analytics.service.js';
import { getMarketScanStatuses, startMarketScan } from '../services/rss/rss.service.js';
import { getRecommendationDateRange } from '../utils/recommendationDate.js';
import { addCalendarEventHints, type StockCarrier } from '../services/calendar/eventIndicator.service.js';
import { getMarketNewsHighlights } from '../services/news/newsSentiment.service.js';
import { getCalendarRefreshStatus, startCalendarRefresh } from '../services/calendar/calendarRefresh.service.js';

export async function dashboard(req: Request, res: Response) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const dateRange = getRecommendationDateRange(req.query);
  const recommendationFilter = dateRange ? { recommendationDate: dateRange } : {};
  const [rawAnalytics, recommendationsToday, stocksCovered, rawLatest, marketMood, marketNews] = await Promise.all([
    getStockAnalytics(undefined, dateRange), Recommendation.countDocuments({ recommendationDate: { $gte: start } }),
    Stock.countDocuments({ active: { $ne: false } }), Recommendation.find(recommendationFilter).sort({ recommendationDate: -1 }).limit(8).populate('stock broker').populate({ path: 'article', populate: { path: 'publisher' } }).populate({ path: 'articles', populate: { path: 'publisher' } }).lean(),
    getRecommendationMarketMood(),
    getMarketNewsHighlights(),
  ]);
  const [analytics, latest] = await Promise.all([
    addCalendarEventHints(rawAnalytics, req.query.eventDate),
    addCalendarEventHints(rawLatest as unknown as StockCarrier[], req.query.eventDate),
  ]);
  const hotStocks = [...analytics].sort((a, b) => b.uniqueBrokerCount - a.uniqueBrokerCount);
  // Rank by evidence strength (unique brokers) first, then buy percentage, so newly covered
  // stocks visibly rise instead of the list freezing on percentage-only ties (e.g. many 100% BUY).
  const strongBuys = analytics.filter((item) => item.consensus === 'BUY')
    .sort((a, b) => b.uniqueBrokerCount - a.uniqueBrokerCount || b.buyPercentage - a.buyPercentage || b.totalRecommendations - a.totalRecommendations)
    .slice(0, 5);
  res.json({
    summary: { recommendationsToday, stocksCovered, buyRecommendations: analytics.reduce((n, item) => n + item.buyCount, 0), sellRecommendations: analytics.reduce((n, item) => n + item.sellCount, 0) },
    freshness: { latestRecommendationDate: rawLatest[0]?.recommendationDate || null },
    hotStocks, strongBuys, latest, marketMood, marketNews,
  });
}

export async function marketMood(_req: Request, res: Response) {
  res.json(await getRecommendationMarketMood());
}

export function dashboardRefreshStatus(_req: Request, res: Response) {
  const market = getMarketScanStatuses();
  res.json({ ...market, calendar: getCalendarRefreshStatus() });
}

export function refreshMarketNews(req: Request, res: Response) {
  const scope = String(req.params.scope || 'recommendations').toLowerCase();
  if (!['recommendations', 'news', 'calendar', 'all'].includes(scope)) {
    res.status(400).json({ message: 'Refresh scope must be recommendations, news, calendar, or all.' });
    return;
  }

  const tasks: Record<string, unknown> = {};
  if (scope === 'recommendations' || scope === 'all') tasks.recommendations = startMarketScan('recommendations');
  if (scope === 'news' || scope === 'all') tasks.news = startMarketScan('news');
  if (scope === 'calendar' || scope === 'all') tasks.calendar = startCalendarRefresh();
  res.status(202).json({ message: `${scope === 'all' ? 'All dashboard refreshes' : `${scope} refresh`} started in the background.`, tasks });
}

export async function hotStocks(req: Request, res: Response) {
  const analytics = await getStockAnalytics(undefined, getRecommendationDateRange(req.query));
  const marked = await addCalendarEventHints(analytics, req.query.eventDate);
  res.json([...marked].sort((a, b) => b.uniqueBrokerCount - a.uniqueBrokerCount));
}
