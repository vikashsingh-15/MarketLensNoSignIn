import type { Types } from 'mongoose';
import { Recommendation } from '../../models/Recommendation.js';
import { QuantSignalResult } from '../../models/QuantSignalResult.js';
import { Stock, type IStock } from '../../models/Stock.js';
import {
  STRATEGY_KEYS,
  StrategyScreenResult,
  type IStrategyCriterion,
  type StrategyKey,
  type StrategyStatus,
} from '../../models/StrategyScreenResult.js';
import { getCoreMarketData, getHistoricalQualityData, type HistoricalQualityYear } from '../market/yahooFinance.service.js';
import { markInsufficientHistory, markMarketDataError, markMarketDataReady } from '../stock/marketDataStatus.service.js';
import { calculateAndSaveQuantSignals, InsufficientMarketHistoryError } from './quantSignal.service.js';

export const STRATEGY_DEFINITIONS: Array<{ key: StrategyKey; name: string; inspiredBy: string; description: string }> = [
  { key: 'DEFENSIVE_VALUE', name: 'Defensive Value', inspiredBy: 'Benjamin Graham-style defensive value', description: 'Looks for low P/E and P/B, strong current liquidity, and a price below a conservative earnings-and-assets estimate.' },
  { key: 'GROWTH_AT_VALUE', name: 'Growth at a Fair Price', inspiredBy: 'Peter Lynch-style growth at a reasonable price', description: 'Looks for healthy earnings growth without excessive PEG valuation, leverage, or company size.' },
  { key: 'ASSET_BARGAIN', name: 'Asset Bargain', inspiredBy: 'Walter Schloss-style deep asset value', description: 'Looks for low price-to-book shares near yearly lows with very limited balance-sheet leverage.' },
  { key: 'TOTAL_RETURN_VALUE', name: 'Total Return Value', inspiredBy: 'John Neff-style total-return value', description: 'Combines a low earnings valuation with growth, dividend yield, and positive free cash flow.' },
  { key: 'QUALITY_COMPOUNDER', name: 'Quality Compounder', inspiredBy: 'Warren Buffett-style quality and economic moat', description: 'Looks for high returns on equity, strong margins and cash generation, with restrained debt.' },
  { key: 'CONSISTENT_COMPOUNDER', name: 'Consistent Compounder', inspiredBy: 'Coffee Can-style consistency', description: 'Uses multi-year revenue growth, capital efficiency, and positive operating cash generation; the approach was popularized in India by Saurabh Mukherjea.' },
];

type CoreData = Awaited<ReturnType<typeof getCoreMarketData>>;
type HistoryData = Awaited<ReturnType<typeof getHistoricalQualityData>>;

const available = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const ratio = (value: number) => `${value.toFixed(2)}x`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const rupees = (value: number) => `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value)}`;

function criterion(
  key: string,
  label: string,
  value: number | null | undefined,
  target: string,
  test: (actual: number) => boolean,
  format: (actual: number) => string = ratio,
  note?: string,
): IStrategyCriterion {
  const actual = available(value) ? value : null;
  return { key, label, value: actual, displayValue: actual == null ? 'Data unavailable' : format(actual), target, passed: actual == null ? null : test(actual), note };
}

function result(strategy: StrategyKey, criteria: IStrategyCriterion[]) {
  const availableCount = criteria.filter((item) => item.passed != null).length;
  const passCount = criteria.filter((item) => item.passed === true).length;
  const dataCompleteness = Math.round(availableCount / criteria.length * 100);
  const score = Math.round(passCount / criteria.length * 100);
  let status: StrategyStatus;
  if (dataCompleteness < 75) status = 'INSUFFICIENT_DATA';
  else if (passCount === criteria.length) status = 'PASS';
  else if (score >= 75) status = 'NEAR';
  else status = 'FAIL';
  return { strategy, criteria, status, score, dataCompleteness };
}

function historicalCriteria(years: HistoricalQualityYear[]) {
  const revenueYears = years.filter((year) => available(year.totalRevenue) && year.totalRevenue > 0);
  const first = revenueYears[0];
  const last = revenueYears.at(-1);
  const yearSpan = first && last ? last.year - first.year : 0;
  const revenueCagr = first && last && yearSpan >= 3 && first.totalRevenue && last.totalRevenue
    ? Math.pow(last.totalRevenue / first.totalRevenue, 1 / yearSpan) - 1
    : null;
  const roceValues = years.map((year) => year.returnOnCapital).filter(available);
  const minimumRoce = roceValues.length >= 3 ? Math.min(...roceValues) : null;
  const cashYears = years.map((year) => year.operatingCashFlow).filter(available);
  const positiveCashShare = cashYears.length >= 3 ? cashYears.filter((value) => value > 0).length / cashYears.length : null;
  return [
    criterion('history', 'Complete fiscal history', revenueYears.length || null, 'At least 4 annual revenue records', (value) => value >= 4, (value) => `${value.toFixed(0)} years`, 'Yahoo commonly exposes fewer than ten Indian fiscal years; the received coverage is shown explicitly.'),
    criterion('revenueCagr', 'Revenue CAGR', revenueCagr, '> 10% across available history', (value) => value > 0.10, percent),
    criterion('minimumRoce', 'Minimum annual return on capital', minimumRoce, '> 15% in every measured year', (value) => value > 0.15, percent),
    criterion('cashConsistency', 'Positive operating cash flow', positiveCashShare, 'Positive in every measured year', (value) => value === 1, percent),
  ];
}

export function evaluateStrategies(core: CoreData, history?: HistoryData) {
  const s = core.screening;
  const q = core.quality;
  const grahamNumber = available(s.trailingEps) && s.trailingEps > 0 && available(s.bookValuePerShare) && s.bookValuePerShare > 0
    ? Math.sqrt(22.5 * s.trailingEps * s.bookValuePerShare)
    : null;
  const totalReturnRatio = available(s.earningsGrowth) && available(s.dividendYield) && available(core.trailingPE) && core.trailingPE > 0
    ? ((s.earningsGrowth * 100) + (s.dividendYield * 100)) / core.trailingPE
    : null;

  return [
    result('DEFENSIVE_VALUE', [
      criterion('trailingPE', 'Trailing P/E', core.trailingPE, '< 15x and positive', (value) => value > 0 && value < 15),
      criterion('priceToBook', 'Price to book', s.priceToBook, '< 1.5x and positive', (value) => value > 0 && value < 1.5),
      criterion('grahamNumber', 'Price vs conservative value', available(core.currentPrice) && available(grahamNumber) ? core.currentPrice / grahamNumber : null, 'Price below Graham-style value', (value) => value < 1, (value) => `${ratio(value)} of estimate`),
      criterion('currentRatio', 'Current ratio', s.currentRatio, '> 2.0x', (value) => value > 2),
    ]),
    result('GROWTH_AT_VALUE', [
      criterion('pegRatio', 'PEG ratio', q.pegRatio, 'Between 0x and 1x', (value) => value > 0 && value < 1),
      criterion('earningsGrowth', 'Earnings growth', s.earningsGrowth, '10% to 40%', (value) => value >= 0.10 && value <= 0.40, percent),
      criterion('debtToEquity', 'Debt to equity', q.debtToEquityRatio, '< 1.0x', (value) => value < 1),
      criterion('marketCap', 'Small/mid-cap preference', core.marketCap, '< ₹1 lakh crore heuristic', (value) => value < 1_000_000_000_000, rupees),
    ]),
    result('ASSET_BARGAIN', [
      criterion('priceToBook', 'Price to book', s.priceToBook, '< 1.0x and positive', (value) => value > 0 && value < 1),
      criterion('rangePosition', 'Position in 52-week range', core.rangePositionPercent, 'Within the bottom 15%', (value) => value <= 15, (value) => `${value.toFixed(1)}% from low to high`),
      criterion('debtToEquity', 'Debt to equity', q.debtToEquityRatio, '< 0.25x', (value) => value < 0.25),
    ]),
    result('TOTAL_RETURN_VALUE', [
      criterion('trailingPE', 'Trailing P/E', core.trailingPE, 'Below 10x and positive', (value) => value > 0 && value < 10),
      criterion('revenueGrowth', 'Revenue growth', s.revenueGrowth, '7% to 25%', (value) => value >= 0.07 && value <= 0.25, percent),
      criterion('totalReturnRatio', 'Growth + yield / P/E', totalReturnRatio, '> 1.0x', (value) => value > 1),
      criterion('freeCashFlow', 'Free cash flow', q.freeCashFlow, 'Positive', (value) => value > 0, rupees),
    ]),
    result('QUALITY_COMPOUNDER', [
      criterion('returnOnEquity', 'Return on equity', q.returnOnEquity, '> 15%', (value) => value > 0.15, percent),
      criterion('profitMargin', 'Profit margin', s.profitMargin, '> 10%', (value) => value > 0.10, percent),
      criterion('debtToEquity', 'Debt to equity', q.debtToEquityRatio, '< 0.5x', (value) => value < 0.5),
      criterion('operatingCashFlow', 'Operating cash flow', s.operatingCashFlow, 'Positive', (value) => value > 0, rupees),
    ]),
    result('CONSISTENT_COMPOUNDER', historicalCriteria(history?.years || [])),
  ];
}

async function scanOne(stock: IStock & { _id: Types.ObjectId }) {
  let core: CoreData;
  try { core = await getCoreMarketData(stock); }
  catch (error) { await markMarketDataError(stock._id, error); throw error; }
  let history: HistoryData | undefined;
  try { history = await getHistoricalQualityData(stock); }
  catch (error) { console.warn(`Yahoo Finance history failed for ${stock.symbol}:`, error instanceof Error ? error.message : error); }
  const asOf = new Date();
  const evaluations = evaluateStrategies(core, history);
  await Promise.all(evaluations.map((evaluation) => StrategyScreenResult.updateOne(
    { stock: stock._id, strategy: evaluation.strategy },
    { $set: { ...evaluation, source: 'Yahoo Finance', yahooSymbol: core.yahooSymbol, asOf } },
    { upsert: true },
  )));
  try {
    await calculateAndSaveQuantSignals(stock, core);
    await markMarketDataReady(stock._id, core.yahooSymbol);
  } catch (error) {
    if (error instanceof InsufficientMarketHistoryError) {
      await markInsufficientHistory(stock._id, core.yahooSymbol, error.available, error.required);
    } else {
      const classified = await markMarketDataError(stock._id, error);
      console.warn(`Market-data ${classified.code.toLowerCase()} for ${stock.symbol}: ${classified.message}`);
    }
  }
}

const onDemandScans = new Map<string, Promise<void>>();

export async function refreshStockStrategyScreen(symbol: string) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const stock = await Stock.findOne({ active: { $ne: false }, $or: [{ symbol: normalizedSymbol }, { aliases: normalizedSymbol }] }).lean();
  if (!stock) return null;
  let scan = onDemandScans.get(normalizedSymbol);
  if (!scan) {
    scan = scanOne(stock).finally(() => onDemandScans.delete(normalizedSymbol));
    onDemandScans.set(normalizedSymbol, scan);
  }
  await scan;
  return StrategyScreenResult.find({ stock: stock._id }).sort({ score: -1 }).lean();
}

async function selectUniverse(limit: number, symbols?: string[]) {
  const now = new Date();
  const eligible = {
    active: { $ne: false },
    $or: [{ nextDataRetryAt: { $exists: false } }, { nextDataRetryAt: null }, { nextDataRetryAt: { $lte: now } }],
  };
  if (symbols?.length) return Stock.find({ ...eligible, symbol: { $in: symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean) } }).limit(limit).lean();
  const recommendedIds = await Recommendation.distinct('stock');
  const screenedIds = await StrategyScreenResult.distinct('stock');
  const quantScreenedIds = await QuantSignalResult.distinct('stock');
  const selected = await Stock.find({ ...eligible, _id: { $in: recommendedIds, $nin: quantScreenedIds } }).sort({ symbol: 1 }).limit(limit).lean();
  if (selected.length >= limit) return selected;
  let chosen = selected.map((stock) => stock._id);
  const missingQuant = await Stock.find({ ...eligible, _id: { $in: screenedIds, $nin: [...chosen, ...quantScreenedIds] } }).sort({ symbol: 1 }).limit(limit - selected.length).lean();
  selected.push(...missingQuant);
  if (selected.length >= limit) return selected;
  chosen = selected.map((stock) => stock._id);
  const unseen = await Stock.find({ ...eligible, _id: { $nin: [...chosen, ...screenedIds] } }).sort({ symbol: 1 }).limit(limit - selected.length).lean();
  selected.push(...unseen);
  if (selected.length >= limit) return selected;
  const refreshBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleIds = await StrategyScreenResult.aggregate<{ _id: Types.ObjectId; lastScanned: Date }>([
    { $group: { _id: '$stock', lastScanned: { $max: '$asOf' } } },
    { $match: { lastScanned: { $lte: refreshBefore }, _id: { $nin: selected.map((stock) => stock._id) } } },
    { $sort: { lastScanned: 1 } },
    { $limit: limit - selected.length },
  ]);
  const staleStocks = await Stock.find({ ...eligible, _id: { $in: staleIds.map((item) => item._id) } }).lean();
  const staleOrder = new Map(staleIds.map((item, index) => [String(item._id), index]));
  staleStocks.sort((a, b) => (staleOrder.get(String(a._id)) || 0) - (staleOrder.get(String(b._id)) || 0));
  selected.push(...staleStocks);
  return selected;
}

export interface StrategyScanSummary { requested: number; completed: number; errors: Array<{ symbol: string; message: string }>; finishedAt: string }
let activeScan: Promise<StrategyScanSummary> | null = null;

async function executeStrategyScreenScan(options: { limit?: number; symbols?: string[] } = {}): Promise<StrategyScanSummary> {
  const limit = Math.max(1, Math.min(options.limit || 20, 100));
  const stocks = await selectUniverse(limit, options.symbols);
  const errors: Array<{ symbol: string; message: string }> = [];
  let completed = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, stocks.length) }, async () => {
    while (cursor < stocks.length) {
      const stock = stocks[cursor++];
      try { await scanOne(stock); completed += 1; }
      catch (error) { errors.push({ symbol: stock.symbol, message: error instanceof Error ? error.message : String(error) }); }
    }
  });
  await Promise.all(workers);
  return { requested: stocks.length, completed, errors, finishedAt: new Date().toISOString() };
}

export function runStrategyScreenScan(options: { limit?: number; symbols?: string[] } = {}) {
  if (activeScan) return activeScan;
  activeScan = (async () => {
    try { return await executeStrategyScreenScan(options); }
    finally { activeScan = null; }
  })();
  return activeScan;
}

export async function strategyScreenOverview(query: { strategy?: string; status?: string; limit?: number }) {
  const filter: Record<string, unknown> = {};
  if (STRATEGY_KEYS.includes(query.strategy as StrategyKey)) filter.strategy = query.strategy;
  if (['PASS', 'NEAR', 'FAIL', 'INSUFFICIENT_DATA'].includes(query.status || '')) filter.status = query.status;
  const limit = Math.max(1, Math.min(query.limit || 200, 2500));
  const [results, counts, coveredStockIds, stockCount, newest] = await Promise.all([
    StrategyScreenResult.find(filter).sort({ status: 1, score: -1, asOf: -1 }).limit(limit).populate('stock').lean(),
    StrategyScreenResult.aggregate<{ _id: { strategy: StrategyKey; status: StrategyStatus }; count: number }>([
      { $group: { _id: { strategy: '$strategy', status: '$status' }, count: { $sum: 1 } } },
    ]),
    StrategyScreenResult.distinct('stock'),
    Stock.countDocuments({ active: { $ne: false } }),
    StrategyScreenResult.findOne().sort({ asOf: -1 }).select('asOf').lean(),
  ]);
  return { strategies: STRATEGY_DEFINITIONS, results, counts, coverage: { scannedStocks: coveredStockIds.length, totalStocks: stockCount }, lastUpdated: newest?.asOf || null };
}

export async function stockStrategyScreens(symbol: string) {
  const normalized = symbol.toUpperCase();
  const stock = await Stock.findOne({ active: { $ne: false }, $or: [{ symbol: normalized }, { aliases: normalized }] }).select('_id').lean();
  if (!stock) return null;
  return StrategyScreenResult.find({ stock: stock._id }).sort({ score: -1 }).lean();
}
