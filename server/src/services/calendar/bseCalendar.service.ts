import axios from 'axios';
import { CorporateEvent, type CorporateEventStatus, type CorporateEventType } from '../../models/CorporateEvent.js';
import { resolveStock } from '../stock/normalization.service.js';

const BSE_API_URL = 'https://api.bseindia.com/BseIndiaAPI/api/CorpSearchForthBoardMeeting/w';
export const BSE_CALENDAR_URL = 'https://www.bseindia.com/corporates/board_meeting.aspx';
const CHUNK_DAYS = 31;

type BseMeeting = {
  scrip_code: number | string;
  Short_name: string;
  PURPOSE_NAME: string;
  MEETING_DATE: string;
  URL?: string;
  CancelFla?: string;
};

type BseResponse = { Table?: BseMeeting[]; Table1?: BseMeeting[] };

export type CalendarSyncSummary = {
  rangesFetched: number;
  eventsReceived: number;
  eventsUpserted: number;
  stocksMatched: number;
  revisedEvents: number;
  errors: number;
};

const bseHeaders = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.bseindia.com/corporates/board_meeting',
  'User-Agent': 'Mozilla/5.0',
};

const formatBseDate = (date: Date) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata',
}).format(date);

const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata',
}).format(date);

function parseBseDate(value: string) {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  const iso = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00.000+05:30`);
}

export function classifyCorporateEvents(purpose: string): CorporateEventType[] {
  const value = purpose.toLowerCase();
  const types: CorporateEventType[] = [];
  if (/quarterly results|annual results|audited results|financial results|results/.test(value)) types.push('EARNINGS');
  if (/merger|amalgamation|demerger|acquisition|scheme of arrangement/.test(value)) types.push('MERGER');
  if (/dividend/.test(value)) types.push('DIVIDEND');
  if (/buy.?back/.test(value)) types.push('BUYBACK');
  if (/bonus/.test(value)) types.push('BONUS');
  if (/stock split|sub.?division|split/.test(value)) types.push('SPLIT');
  if (/fund.?rais|rights issue|preferential|qip|warrant|issue of shares|private placement/.test(value)) types.push('FUND_RAISE');
  if (/a\.?g\.?m\.?|annual general meeting/.test(value)) types.push('AGM');
  return types.length ? types : ['BOARD_MEETING'];
}

export const classifyCorporateEvent = (purpose: string) => classifyCorporateEvents(purpose)[0];

async function fetchRange(from: Date, to: Date) {
  const { data } = await axios.get<BseResponse>(BSE_API_URL, {
    headers: bseHeaders,
    params: { SCRIPCODE: '', fromDT: formatBseDate(from), ToDt: formatBseDate(to), purposeCode: '', IsCanRev: 0 },
    timeout: 30_000,
  });
  return [
    ...(data.Table || []).map((meeting) => ({ meeting, status: 'SCHEDULED' as CorporateEventStatus })),
    ...(data.Table1 || []).map((meeting) => ({ meeting, status: 'REVISED' as CorporateEventStatus })),
  ];
}

export async function syncBseCalendar(options: { from?: Date; to?: Date } = {}): Promise<CalendarSyncSummary> {
  const existingEvents = await CorporateEvent.estimatedDocumentCount();
  const now = new Date();
  const from = options.from || new Date(now.getTime() - (existingEvents ? 31 : 365) * 86_400_000);
  const to = options.to || new Date(now.getTime() + 180 * 86_400_000);
  const summary: CalendarSyncSummary = { rangesFetched: 0, eventsReceived: 0, eventsUpserted: 0, stocksMatched: 0, revisedEvents: 0, errors: 0 };
  const stockMatches = new Map<string, Awaited<ReturnType<typeof resolveStock>>>();

  for (let cursor = new Date(from); cursor <= to;) {
    const chunkEnd = new Date(Math.min(to.getTime(), cursor.getTime() + (CHUNK_DAYS - 1) * 86_400_000));
    try {
      const records = await fetchRange(cursor, chunkEnd);
      summary.rangesFetched += 1;
      summary.eventsReceived += records.length;
      const deduplicated = new Map<string, (typeof records)[number]>();
      for (const record of records) {
        const eventDate = parseBseDate(record.meeting.MEETING_DATE);
        if (!eventDate) { summary.errors += 1; continue; }
        const key = `${record.meeting.scrip_code}|${dateKey(eventDate)}|${record.meeting.PURPOSE_NAME.trim().toLowerCase()}`;
        deduplicated.set(key, record);
      }

      const operations = [];
      for (const [sourceEventKey, { meeting, status }] of deduplicated) {
        const eventDate = parseBseDate(meeting.MEETING_DATE);
        if (!eventDate) continue;
        const symbol = meeting.Short_name.trim().toUpperCase();
        if (!stockMatches.has(symbol)) stockMatches.set(symbol, await resolveStock(symbol, symbol));
        const stock = stockMatches.get(symbol);
        if (stock) summary.stocksMatched += 1;
        if (status === 'REVISED') summary.revisedEvents += 1;
        operations.push({ updateOne: {
          filter: { sourceEventKey },
          update: { $set: {
            ...(stock ? { stock: stock._id } : {}), source: 'BSE' as const, sourceEventKey,
            bseCode: String(meeting.scrip_code), securityName: symbol,
            eventType: classifyCorporateEvent(meeting.PURPOSE_NAME), eventTypes: classifyCorporateEvents(meeting.PURPOSE_NAME), purpose: meeting.PURPOSE_NAME.trim(),
            eventDate, status, sourceUrl: meeting.URL || BSE_CALENDAR_URL,
          } },
          upsert: true as const,
        } });
      }
      if (operations.length) await CorporateEvent.bulkWrite(operations, { ordered: false });
      summary.eventsUpserted += operations.length;
    } catch (error) {
      summary.errors += 1;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      console.warn(`BSE calendar range failed: ${formatBseDate(cursor)} to ${formatBseDate(chunkEnd)}${status ? ` (HTTP ${status})` : ''}`, error instanceof Error ? error.message : error);
    }
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
  }

  for (;;) {
    const legacyEvents = await CorporateEvent.find({ eventTypes: { $exists: false } }).select('_id purpose').limit(1000).lean();
    if (!legacyEvents.length) break;
    await CorporateEvent.bulkWrite(legacyEvents.map((event) => ({ updateOne: {
      filter: { _id: event._id }, update: { $set: { eventTypes: classifyCorporateEvents(event.purpose) } },
    } })), { ordered: false });
  }

  console.log('BSE calendar sync summary:', summary);
  return summary;
}
