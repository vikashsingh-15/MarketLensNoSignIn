import YahooFinance from 'yahoo-finance2';
import type { IStock } from '../../models/Stock.js';
import { databaseFirstMarketData } from './marketDataCache.service.js';
import { textExplicitlyMentionsStock } from '../stock/normalization.service.js';

export const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const QUOTE_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const FUNDAMENTAL_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STOCK_NEWS_CACHE_MS = 15 * 60 * 1000;

const numberOrNull = (value: number | undefined) => Number.isFinite(value) ? value! : null;

export const yahooCandidates = (stock: Pick<IStock, 'symbol' | 'exchange'>) => {
  const symbol = stock.symbol.toUpperCase();
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return [symbol];
  return stock.exchange.toUpperCase() === 'BSE' ? [`${symbol}.BO`, `${symbol}.NS`] : [`${symbol}.NS`, `${symbol}.BO`];
};

export interface YahooStockNewsItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: Date;
  relatedTickers: string[];
}

const stockNewsCache = new Map<string, { expiresAt: number; items: YahooStockNewsItem[] }>();

export async function getYahooStockNews(stock: Pick<IStock, 'symbol' | 'companyName' | 'exchange' | 'aliases'>, limit = 12) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 30));
  const cacheKey = `${stock.exchange}:${stock.symbol}:${safeLimit}`;
  const cached = stockNewsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const candidateSymbols = yahooCandidates(stock);
  const searchQueries = [...candidateSymbols, stock.companyName];
  const canonicalCandidates = new Set(candidateSymbols.map((value) => value.toUpperCase()));
  let lastError: unknown;
  for (const query of searchQueries) {
    try {
      const result = await yahooFinance.search(query, {
        quotesCount: 0,
        newsCount: safeLimit * 2,
        enableFuzzyQuery: false,
      });
      const items = result.news.filter((item) => {
        const exactRelatedTicker = (item.relatedTickers || []).some((ticker) => canonicalCandidates.has(ticker.toUpperCase()));
        return exactRelatedTicker || textExplicitlyMentionsStock(item.title, stock);
      }).slice(0, safeLimit).map((item) => ({
        id: item.uuid,
        title: item.title,
        url: item.link,
        publisher: item.publisher || 'Yahoo Finance',
        publishedAt: item.providerPublishTime,
        relatedTickers: item.relatedTickers || [],
      }));
      if (items.length) {
        stockNewsCache.set(cacheKey, { expiresAt: Date.now() + STOCK_NEWS_CACHE_MS, items });
        return items;
      }
    } catch (error) { lastError = error; }
  }
  if (lastError) console.warn(`Yahoo Finance stock news failed for ${stock.symbol}:`, lastError instanceof Error ? lastError.message : lastError);
  stockNewsCache.set(cacheKey, { expiresAt: Date.now() + Math.min(STOCK_NEWS_CACHE_MS, 2 * 60 * 1000), items: [] });
  return [];
}

type MarketDataModule = 'price' | 'summaryDetail' | 'defaultKeyStatistics' | 'financialData' | 'recommendationTrend' | 'majorHoldersBreakdown' | 'netSharePurchaseActivity' | 'institutionOwnership';

async function quoteSummaryWithFallback(stock: Pick<IStock, 'symbol' | 'exchange'>, modules: MarketDataModule[]) {
  let lastError: unknown;
  for (const yahooSymbol of yahooCandidates(stock)) {
    try {
      const result = await yahooFinance.quoteSummary(yahooSymbol, { modules });
      return { yahooSymbol, result };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(`Yahoo Finance data unavailable for ${stock.symbol}`);
}

export async function getCoreMarketData(stock: Pick<IStock, 'symbol' | 'exchange'>) {
  const quotePromise = databaseFirstMarketData(stock, 'QUOTE', async () => {
    const { yahooSymbol, result } = await quoteSummaryWithFallback(stock, ['price', 'summaryDetail']);
    const price = result.price;
    const summary = result.summaryDetail;
    const currentPrice = price?.regularMarketPrice;
    const low = summary?.fiftyTwoWeekLow;
    const high = summary?.fiftyTwoWeekHigh;
    const rangePositionPercent = currentPrice != null && low != null && high != null && high > low
      ? Math.max(0, Math.min(100, (currentPrice - low) / (high - low) * 100))
      : null;
    const dayHigh = price?.regularMarketDayHigh;
    const dayLow = price?.regularMarketDayLow;
    const dayRangePositionPercent = currentPrice != null && dayLow != null && dayHigh != null && dayHigh > dayLow
      ? Math.max(0, Math.min(100, (currentPrice - dayLow) / (dayHigh - dayLow) * 100))
      : null;
    return {
      source: 'Yahoo Finance' as const, yahooSymbol, updatedAt: new Date().toISOString(),
      marketTime: price?.regularMarketTime?.toISOString() || null,
      exchangeDelayMinutes: price?.exchangeDataDelayedBy ?? null,
      currency: price?.currency || summary?.currency || 'INR', currentPrice: numberOrNull(currentPrice),
      previousClose: numberOrNull(price?.regularMarketPreviousClose ?? summary?.previousClose),
      change: numberOrNull(price?.regularMarketChange), changePercent: numberOrNull(price?.regularMarketChangePercent),
      fiftyTwoWeekLow: numberOrNull(low), fiftyTwoWeekHigh: numberOrNull(high), rangePositionPercent,
      dayHigh: numberOrNull(dayHigh), dayLow: numberOrNull(dayLow), dayRangePositionPercent,
      volume: numberOrNull(price?.regularMarketVolume), averageVolume: numberOrNull(summary?.averageVolume),
      trailingPE: numberOrNull(summary?.trailingPE), marketCap: numberOrNull(summary?.marketCap ?? price?.marketCap),
    };
  }, QUOTE_MAX_STALE_MS);

  const fundamentalsPromise = databaseFirstMarketData(stock, 'FUNDAMENTALS', async () => {
    const { yahooSymbol, result } = await quoteSummaryWithFallback(stock, [
      'summaryDetail', 'defaultKeyStatistics', 'financialData', 'recommendationTrend', 'majorHoldersBreakdown', 'institutionOwnership',
    ]);
    const summary = result.summaryDetail;
    const statistics = result.defaultKeyStatistics;
    const financial = result.financialData;
    const target = financial?.targetMeanPrice;
    const trend = result.recommendationTrend?.trend.find((item) => item.period === '0m') || result.recommendationTrend?.trend[0] || null;
    const ownership = result.institutionOwnership?.ownershipList || [];
    const ownershipChanges = ownership.map((holder) => {
      const previous = holder.pctChange != null && holder.pctChange > -1 ? holder.position / (1 + holder.pctChange) : null;
      return previous != null && previous > 0 ? { current: holder.position, previous } : null;
    }).filter((item): item is { current: number; previous: number } => item != null);
    const currentInstitutionPositions = ownershipChanges.reduce((sum, item) => sum + item.current, 0);
    const previousInstitutionPositions = ownershipChanges.reduce((sum, item) => sum + item.previous, 0);

    return {
      source: 'Yahoo Finance' as const, yahooSymbol, updatedAt: new Date().toISOString(),
      currency: summary?.currency || financial?.financialCurrency || 'INR',
      forwardPE: numberOrNull(summary?.forwardPE ?? statistics?.forwardPE),
      analystTarget: {
        mean: numberOrNull(target), median: numberOrNull(financial?.targetMedianPrice),
        low: numberOrNull(financial?.targetLowPrice), high: numberOrNull(financial?.targetHighPrice),
        analystCount: numberOrNull(financial?.numberOfAnalystOpinions),
      },
      yahooRecommendation: {
        key: financial?.recommendationKey || null,
        mean: numberOrNull(financial?.recommendationMean),
        trend: trend ? { period: trend.period, strongBuy: trend.strongBuy, buy: trend.buy, hold: trend.hold, sell: trend.sell, strongSell: trend.strongSell } : null,
      },
      quality: {
        returnOnEquity: numberOrNull(financial?.returnOnEquity),
        debtToEquityRatio: financial?.debtToEquity != null ? financial.debtToEquity / 100 : null,
        freeCashFlow: numberOrNull(financial?.freeCashflow),
        operatingMargin: numberOrNull(financial?.operatingMargins),
        pegRatio: numberOrNull(statistics?.pegRatio),
      },
      screening: {
        priceToBook: numberOrNull(statistics?.priceToBook),
        trailingEps: numberOrNull(statistics?.trailingEps),
        bookValuePerShare: numberOrNull(statistics?.bookValue),
        currentRatio: numberOrNull(financial?.currentRatio),
        earningsGrowth: numberOrNull(financial?.earningsGrowth),
        revenueGrowth: numberOrNull(financial?.revenueGrowth),
        totalDebt: numberOrNull(financial?.totalDebt),
        profitMargin: numberOrNull(financial?.profitMargins),
        operatingCashFlow: numberOrNull(financial?.operatingCashflow),
        dividendYield: numberOrNull(summary?.dividendYield),
        institutionalOwnership: numberOrNull(result.majorHoldersBreakdown?.institutionsPercentHeld),
        institutionPositionChange: previousInstitutionPositions > 0 ? (currentInstitutionPositions - previousInstitutionPositions) / previousInstitutionPositions : null,
        institutionReportDate: ownership[0]?.reportDate?.toISOString() || null,
        institutionHolderCount: ownership.length,
      },
    };
  }, FUNDAMENTAL_MAX_STALE_MS);

  const [quote, fundamentals] = await Promise.all([quotePromise, fundamentalsPromise]);
  const target = fundamentals.analystTarget.mean;
  const targetUpsidePercent = quote.currentPrice && target != null ? (target - quote.currentPrice) / quote.currentPrice * 100 : null;
  return {
    ...quote,
    currency: quote.currency || fundamentals.currency,
    forwardPE: fundamentals.forwardPE,
    analystTarget: { ...fundamentals.analystTarget, upsidePercent: targetUpsidePercent },
    yahooRecommendation: fundamentals.yahooRecommendation,
    quality: fundamentals.quality,
    screening: fundamentals.screening,
    cache: { quote: quote.cache, fundamentals: fundamentals.cache },
  };
}

export interface DailyMarketCandle { date: string; open: number; high: number; low: number; close: number; volume: number }

export async function getDailyMarketHistory(stock: Pick<IStock, 'symbol' | 'exchange'>) {
  return databaseFirstMarketData(stock, 'DAILY_CHART', async () => {
    let lastError: unknown;
    for (const yahooSymbol of yahooCandidates(stock)) {
      try {
        const chart = await yahooFinance.chart(yahooSymbol, {
          period1: new Date(new Date().setFullYear(new Date().getFullYear() - 4)),
          period2: new Date(), interval: '1d', return: 'array',
        });
        const candles = chart.quotes.map((quote): DailyMarketCandle | null => {
          if (quote.open == null || quote.high == null || quote.low == null || quote.close == null || quote.volume == null) return null;
          const adjustment = quote.adjclose != null && quote.close !== 0 ? quote.adjclose / quote.close : 1;
          const candle = {
            date: quote.date.toISOString(), open: quote.open * adjustment, high: quote.high * adjustment,
            low: quote.low * adjustment, close: quote.close * adjustment, volume: quote.volume,
          };
          return Object.values(candle).every((value) => typeof value === 'string' || Number.isFinite(value)) ? candle : null;
        }).filter((candle): candle is DailyMarketCandle => candle != null).sort((a, b) => a.date.localeCompare(b.date));
        return { source: 'Yahoo Finance' as const, yahooSymbol, updatedAt: new Date().toISOString(), candles };
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error(`Yahoo Finance price history unavailable for ${stock.symbol}`);
  }, QUOTE_MAX_STALE_MS);
}

export interface HistoricalQualityYear {
  year: number;
  totalRevenue: number | null;
  returnOnEquity: number | null;
  returnOnCapital: number | null;
  operatingCashFlow: number | null;
}

export async function getHistoricalQualityData(stock: Pick<IStock, 'symbol' | 'exchange'>) {
  return databaseFirstMarketData(stock, 'FINANCIAL_HISTORY', async () => {
    let lastError: unknown;
    for (const yahooSymbol of yahooCandidates(stock)) {
      try {
        const raw = await yahooFinance.fundamentalsTimeSeries(yahooSymbol, {
          period1: new Date(new Date().getFullYear() - 11, 0, 1),
          period2: new Date(),
          type: 'annual',
          module: 'all',
          merge: true,
        }) as unknown as Array<Record<string, unknown>>;
        const years = raw.map((row): HistoricalQualityYear | null => {
          const date = row.date instanceof Date ? row.date : new Date(String(row.date));
          const totalRevenue = numberOrNull(row.totalRevenue as number | undefined);
          const equity = numberOrNull((row.stockholdersEquity ?? row.commonStockEquity) as number | undefined);
          const netIncome = numberOrNull(row.netIncome as number | undefined);
          const ebit = numberOrNull(row.EBIT as number | undefined);
          const investedCapital = numberOrNull(row.investedCapital as number | undefined);
          const capitalBase = investedCapital && investedCapital > 0 ? investedCapital : equity;
          if (!Number.isFinite(date.getTime()) || [totalRevenue, equity, netIncome, ebit, investedCapital].every((value) => value == null)) return null;
          return {
            year: date.getUTCFullYear(),
            totalRevenue,
            returnOnEquity: equity && equity > 0 && netIncome != null ? netIncome / equity : null,
            returnOnCapital: capitalBase && capitalBase > 0 && ebit != null ? ebit / capitalBase : null,
            operatingCashFlow: numberOrNull(row.operatingCashFlow as number | undefined),
          };
        }).filter((year): year is HistoricalQualityYear => year != null)
          .sort((a, b) => a.year - b.year)
          .slice(-10);
        return { source: 'Yahoo Finance' as const, yahooSymbol, updatedAt: new Date().toISOString(), years };
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error(`Yahoo Finance history unavailable for ${stock.symbol}`);
  }, FUNDAMENTAL_MAX_STALE_MS);
}

export async function getAdvancedMarketData(stock: Pick<IStock, 'symbol' | 'exchange'>) {
  return databaseFirstMarketData(stock, 'ADVANCED', async () => {
    const { yahooSymbol, result } = await quoteSummaryWithFallback(stock, [
      'summaryDetail', 'defaultKeyStatistics', 'majorHoldersBreakdown', 'netSharePurchaseActivity',
    ]);
    const summary = result.summaryDetail;
    const statistics = result.defaultKeyStatistics;
    const holders = result.majorHoldersBreakdown;
    const insider = result.netSharePurchaseActivity;
    return {
      source: 'Yahoo Finance' as const,
      yahooSymbol,
      updatedAt: new Date().toISOString(),
      enterpriseToEbitda: numberOrNull(statistics?.enterpriseToEbitda),
      beta: numberOrNull(summary?.beta ?? statistics?.beta),
      institutionalOwnership: numberOrNull(holders?.institutionsPercentHeld ?? statistics?.heldPercentInstitutions),
      institutionCount: numberOrNull(holders?.institutionsCount),
      dividendYield: numberOrNull(summary?.dividendYield),
      payoutRatio: numberOrNull(summary?.payoutRatio),
      insiderActivity: insider ? {
        period: insider.period,
        buyCount: insider.buyInfoCount,
        buyShares: insider.buyInfoShares,
        sellCount: insider.sellInfoCount,
        sellShares: insider.sellInfoShares ?? null,
        netCount: insider.netInfoCount,
        netShares: insider.netInfoShares,
        netPercentInsiderShares: numberOrNull(insider.netPercentInsiderShares),
      } : null,
    };
  }, FUNDAMENTAL_MAX_STALE_MS);
}
