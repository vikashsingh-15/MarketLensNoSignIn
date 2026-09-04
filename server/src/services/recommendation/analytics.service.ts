import type { Types } from 'mongoose';
import { Recommendation } from '../../models/Recommendation.js';
import { Stock } from '../../models/Stock.js';
import type { RecommendationDateRange } from '../../utils/recommendationDate.js';

export type StockAnalytics = {
  stock: { _id: unknown; symbol: string; companyName: string; exchange: string };
  uniqueBrokerCount: number; buyCount: number; holdCount: number; sellCount: number; totalRecommendations: number;
  buyPercentage: number; holdPercentage: number; sellPercentage: number; averageTarget: number | null; medianTarget: number | null; consensus: 'BUY' | 'HOLD' | 'SELL';
};

const percentage = (value: number, total: number) => total ? Math.round(value / total * 1000) / 10 : 0;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

type AnalyticsStock = StockAnalytics['stock'];
type AnalyticsRecord = {
  stock: Types.ObjectId;
  broker: Types.ObjectId;
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  targetPrice?: number;
};

export async function getStockAnalytics(symbols?: string | string[], dateRange?: RecommendationDateRange): Promise<StockAnalytics[]> {
  const requestedSymbols = symbols
    ? (Array.isArray(symbols) ? symbols : [symbols]).map((symbol) => symbol.toUpperCase())
    : null;
  if (requestedSymbols?.length === 0) return [];

  const requestedStocks = requestedSymbols
    ? await Stock.find({ symbol: { $in: requestedSymbols } }).select('_id symbol companyName exchange').lean()
    : null;
  if (requestedStocks?.length === 0) return [];

  const records = await Recommendation.find({
    ...(requestedStocks ? { stock: { $in: requestedStocks.map((stock) => stock._id) } } : {}),
    ...(dateRange ? { recommendationDate: dateRange } : {}),
  })
    .select('stock broker recommendation targetPrice')
    .lean() as unknown as AnalyticsRecord[];
  if (!records.length) return [];

  const stocks = requestedStocks || await Stock.find({
    _id: { $in: [...new Set(records.map((record) => String(record.stock)))] },
  }).select('_id symbol companyName exchange').lean();
  const stockById = new Map(stocks.map((stock) => [String(stock._id), stock as AnalyticsStock]));
  const groups = new Map<string, { stock: AnalyticsStock; recommendations: AnalyticsRecord[] }>();

  for (const item of records) {
    const stock = stockById.get(String(item.stock));
    if (!stock) continue;
    const group = groups.get(stock.symbol) || { stock, recommendations: [] };
    group.recommendations.push(item);
    groups.set(stock.symbol, group);
  }
  return [...groups.values()].map(({ stock, recommendations }) => {
    const buyCount = recommendations.filter((r) => r.recommendation === 'BUY').length;
    const holdCount = recommendations.filter((r) => r.recommendation === 'HOLD').length;
    const sellCount = recommendations.filter((r) => r.recommendation === 'SELL').length;
    const total = recommendations.length;
    const buyPercentage = percentage(buyCount, total);
    const sellPercentage = percentage(sellCount, total);
    const targets = recommendations.map((r) => r.targetPrice).filter((v): v is number => typeof v === 'number');
    return {
      stock: { _id: stock._id, symbol: stock.symbol, companyName: stock.companyName, exchange: stock.exchange },
      uniqueBrokerCount: new Set(recommendations.map((recommendation) => String(recommendation.broker))).size,
      buyCount, holdCount, sellCount, totalRecommendations: total, buyPercentage,
      holdPercentage: percentage(holdCount, total), sellPercentage,
      averageTarget: targets.length ? Math.round(targets.reduce((a, b) => a + b, 0) / targets.length) : null,
      medianTarget: median(targets),
      consensus: buyPercentage >= 60 ? 'BUY' : sellPercentage >= 60 ? 'SELL' : 'HOLD',
    };
  });
}
