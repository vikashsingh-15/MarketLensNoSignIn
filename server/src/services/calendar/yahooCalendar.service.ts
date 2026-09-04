import { CorporateEvent, type CorporateEventType } from '../../models/CorporateEvent.js';
import { Stock, type IStock } from '../../models/Stock.js';
import { Recommendation } from '../../models/Recommendation.js';
import { yahooFinance, yahooCandidates } from '../market/yahooFinance.service.js';
import { REFERENCE_STOCK_SYMBOLS } from '../reference/referenceData.service.js';

/**
 * Yahoo Finance `calendarEvents` module: earnings dates plus ex-dividend and
 * dividend payment dates. These are upserted into the same CorporateEvent
 * collection as the BSE sync (source: 'YAHOO'), so the calendar UI, dashboard
 * focus panel, and stock event indicators pick them up unchanged.
 */
const DEFAULT_LIMIT = 100;
const CONCURRENCY = 4;

type YahooCalendarEvents = {
  earnings?: {
    earningsDate?: Date[];
    earningsAverage?: number;
    earningsLow?: number;
    earningsHigh?: number;
    revenueAverage?: number;
  };
  exDividendDate?: Date;
  dividendDate?: Date;
};

export type YahooCalendarSyncSummary = {
  stocksAttempted: number;
  eventsUpserted: number;
  errors: number;
  finishedAt: string;
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const parseYahooDate = (value?: Date) => (value instanceof Date && !Number.isNaN(value.getTime())) ? value : null;

type PendingEvent = { eventType: CorporateEventType; eventDate: Date; purpose: string };

function buildEvents(stock: Pick<IStock, 'symbol'>, calendar: YahooCalendarEvents, yahooSymbol: string) {
  const events: PendingEvent[] = [];
  const earningsDay = parseYahooDate(calendar.earnings?.earningsDate?.[0]);
  if (earningsDay) {
    const estimate = calendar.earnings?.earningsAverage;
    events.push({
      eventType: 'EARNINGS',
      eventDate: earningsDay,
      purpose: estimate != null
        ? `Earnings announcement; consensus EPS estimate ${estimate.toFixed(2)}`
        : 'Earnings announcement',
    });
  }
  const exDividend = parseYahooDate(calendar.exDividendDate);
  if (exDividend) events.push({ eventType: 'DIVIDEND', eventDate: exDividend, purpose: 'Ex-dividend date' });
  const dividend = parseYahooDate(calendar.dividendDate);
  if (dividend) events.push({ eventType: 'DIVIDEND', eventDate: dividend, purpose: 'Dividend payment date' });
  return events.map((event) => ({
    ...event,
    sourceEventKey: `YAHOO-${stock.symbol}-${event.eventType}-${dateKey(event.eventDate)}`,
    sourceUrl: `https://finance.yahoo.com/quote/${yahooSymbol}`,
  }));
}

async function fetchCalendarEvents(stock: Pick<IStock, 'symbol' | 'exchange'>) {
  let lastError: unknown;
  for (const yahooSymbol of yahooCandidates(stock)) {
    try {
      const result = await yahooFinance.quoteSummary(yahooSymbol, { modules: ['calendarEvents'] });
      if (result.calendarEvents) return { yahooSymbol, calendar: result.calendarEvents as unknown as YahooCalendarEvents };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(`Yahoo calendar data unavailable for ${stock.symbol}`);
}

async function selectUniverse(options: { symbols?: string[]; limit: number }) {
  if (options.symbols?.length) {
    const requested = [...new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
    return Stock.find({ active: { $ne: false }, symbol: { $in: requested } }).sort({ symbol: 1 }).limit(options.limit).lean();
  }
  const recommendedIds = await Recommendation.distinct('stock');
  const trackedIds = [...new Set(recommendedIds.map((id) => String(id)))];
  return Stock.find({
    active: { $ne: false },
    $or: [{ _id: { $in: trackedIds } }, { symbol: { $in: REFERENCE_STOCK_SYMBOLS } }],
  }).sort({ symbol: 1 }).limit(options.limit).lean();
}

export async function syncYahooCalendar(options: { symbols?: string[]; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(Math.floor(options.limit || DEFAULT_LIMIT), 500));
  const stocks = await selectUniverse({ symbols: options.symbols, limit });
  const summary: YahooCalendarSyncSummary = { stocksAttempted: stocks.length, eventsUpserted: 0, errors: 0, finishedAt: new Date().toISOString() };
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, stocks.length) }, async () => {
    while (cursor < stocks.length) {
      const stock = stocks[cursor++];
      try {
        const { yahooSymbol, calendar } = await fetchCalendarEvents(stock);
        const events = buildEvents(stock, calendar, yahooSymbol);
        if (!events.length) continue;
        const operations = events.map((event) => ({
          updateOne: {
            filter: { sourceEventKey: event.sourceEventKey },
            update: {
              $set: {
                stock: stock._id,
                source: 'YAHOO' as const,
                sourceEventKey: event.sourceEventKey,
                securityName: stock.symbol,
                eventType: event.eventType,
                eventTypes: [event.eventType],
                purpose: event.purpose,
                eventDate: event.eventDate,
                status: 'SCHEDULED' as const,
                sourceUrl: event.sourceUrl,
              },
            },
            upsert: true,
          },
        }));
        if (operations.length) await CorporateEvent.bulkWrite(operations, { ordered: false });
        summary.eventsUpserted += operations.length;
      } catch (error) {
        summary.errors += 1;
        console.warn(`Yahoo calendar failed for ${stock.symbol}:`, error instanceof Error ? error.message : error);
      }
    }
  });
  await Promise.all(workers);
  summary.finishedAt = new Date().toISOString();
  return summary;
}
