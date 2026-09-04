import axios from 'axios';
import { CorporateEvent, type CorporateEventType } from '../../models/CorporateEvent.js';
import { resolveStock } from '../stock/normalization.service.js';

/**
 * NSE corporate actions feed (dividends, splits, bonus, rights, buybacks, etc.)
 * for the near-term window. Upserted into the same CorporateEvent collection as
 * the BSE and Yahoo Finance syncs (source: 'NSE'), so the calendar UI, dashboard
 * focus panel, and stock event indicators pick them up unchanged.
 */
const NSE_CORPORATE_ACTIONS_URL = 'https://www.nseindia.com/api/corporates-corporateActions?index=equities';
const NSE_HOME_URL = 'https://www.nseindia.com';
const NSE_ACTIONS_LINK = 'https://www.nseindia.com/companies-listing/corporate-filings-actions';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

type NseCorporateAction = {
  symbol?: string;
  comp?: string;
  subject?: string;
  purpose?: string;
  exDate?: string;
  recDate?: string;
  bcStartDate?: string;
  bcEndDate?: string;
};

export type NseCalendarSyncSummary = {
  eventsReceived: number;
  eventsUpserted: number;
  stocksMatched: number;
  errors: number;
  finishedAt: string;
};

const monthIndex: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseNseDate(value?: string) {
  if (!value || value === '-') return null;
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = monthIndex[match[2].toLowerCase()];
  if (!month) return null;
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00.000+05:30`);
}

export function classifyNseAction(subject: string): CorporateEventType[] {
  const value = subject.toLowerCase();
  const types: CorporateEventType[] = [];
  // Unit distributions (REITs/MFs) and debt interest payments are not share dividends.
  if (/distribution|interest payment|\binterest\b/.test(value)) return ['OTHER'];
  if (/\bdividend\b/.test(value)) types.push('DIVIDEND');
  if (/bonus/i.test(value)) types.push('BONUS');
  if (/split|sub.?division/i.test(value)) types.push('SPLIT');
  if (/\brights\b/i.test(value)) types.push('FUND_RAISE');
  if (/buy.?back/i.test(value)) types.push('BUYBACK');
  if (/merger|amalgamation|demerger|scheme of arrangement/i.test(value)) types.push('MERGER');
  if (/financial results|\bresults\b/i.test(value)) types.push('EARNINGS');
  if (/\ba\.?g\.?m\.?\b/i.test(value)) types.push('AGM');
  return types.length ? types : ['OTHER'];
}

export function extractDividendAmount(subject: string) {
  const match = /(?:Rs|Re)\.?\s*([\d,]+(?:\.\d+)?)/i.exec(subject);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

async function fetchNseCorporateActions(): Promise<NseCorporateAction[]> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    Referer: NSE_HOME_URL,
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { data } = await axios.get<NseCorporateAction[]>(NSE_CORPORATE_ACTIONS_URL, { headers, timeout: 20_000 });
      if (Array.isArray(data)) return data;
      throw new Error('NSE corporate actions returned a non-array payload');
    } catch (error) {
      lastError = error;
      // NSE sometimes rejects requests that lack the session cookie; warm it from the homepage.
      if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
        try {
          const home = await axios.get<string>(NSE_HOME_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, timeout: 15_000 });
          const cookie = (home.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
          if (cookie) headers.Cookie = cookie;
        } catch { /* cookie warm failed; retry without it */ }
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('NSE corporate actions fetch failed');
}

export async function syncNseCalendar(): Promise<NseCalendarSyncSummary> {
  const raw = await fetchNseCorporateActions();
  const summary: NseCalendarSyncSummary = {
    eventsReceived: raw.length,
    eventsUpserted: 0,
    stocksMatched: 0,
    errors: 0,
    finishedAt: new Date().toISOString(),
  };
  const seen = new Set<string>();
  const operations: Array<{
    updateOne: {
      filter: { sourceEventKey: string };
      update: Record<string, unknown>;
      upsert: true;
    };
  }> = [];
  for (const item of raw) {
    const symbol = (item.symbol || '').trim().toUpperCase();
    const subject = (item.subject || item.purpose || '').trim();
    const eventDate = parseNseDate(item.exDate) || parseNseDate(item.recDate) || parseNseDate(item.bcStartDate);
    if (!symbol || !subject || !eventDate) { summary.errors += 1; continue; }
    const types = classifyNseAction(subject);
    const primary = types[0];
    const cleanSubject = subject.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 60);
    const dateKey = eventDate.toISOString().slice(0, 10);
    const sourceEventKey = `NSE-${symbol}-${dateKey}-${cleanSubject}`;
    if (seen.has(sourceEventKey)) continue;
    seen.add(sourceEventKey);
    let stock = null;
    try { stock = await resolveStock(symbol, item.comp || null); } catch { /* leave unlinked */ }
    if (stock) summary.stocksMatched += 1;
    const amount = primary === 'DIVIDEND' ? extractDividendAmount(subject) : null;
    const update: Record<string, unknown> = {
      $set: {
        stock: stock?._id,
        source: 'NSE',
        sourceEventKey,
        securityName: symbol,
        eventType: primary,
        eventTypes: types,
        purpose: subject,
        eventDate,
        status: 'SCHEDULED',
        sourceUrl: NSE_ACTIONS_LINK,
      },
    };
    if (amount != null) (update.$set as Record<string, unknown>).dividendAmount = amount;
    else update.$unset = { dividendAmount: 1 };
    operations.push({ updateOne: { filter: { sourceEventKey }, update, upsert: true } });
  }
  if (operations.length) await CorporateEvent.bulkWrite(operations, { ordered: false });
  summary.eventsUpserted = operations.length;
  summary.finishedAt = new Date().toISOString();
  return summary;
}
