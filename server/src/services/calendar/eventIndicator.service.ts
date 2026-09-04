import { CorporateEvent, type CorporateEventType } from '../../models/CorporateEvent.js';
import { parseIstDateOnly } from '../../utils/recommendationDate.js';

export type CalendarEventHint = {
  _id: string;
  date: string;
  eventTypes: CorporateEventType[];
  purpose: string;
  status: 'SCHEDULED' | 'REVISED';
};

export type StockCarrier = {
  stock: { _id: unknown; symbol: string };
};

const istDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata',
}).format(date);

function eventDay(value: unknown) {
  const requested = String(value || '');
  const key = parseIstDateOnly(requested, false) ? requested : istDateKey(new Date());
  const start = parseIstDateOnly(key, false)!;
  return { key, start, end: new Date(start.getTime() + 86_400_000 - 1) };
}

export async function addCalendarEventHints<T extends StockCarrier>(items: T[], requestedDate?: unknown) {
  if (!items.length) return items;
  const { key, start, end } = eventDay(requestedDate);
  const stockIds = [...new Set(items.map((item) => String(item.stock._id)))];
  const symbols = [...new Set(items.map((item) => item.stock.symbol.toUpperCase()))];
  const events = await CorporateEvent.find({
    eventDate: { $gte: start, $lte: end },
    $or: [{ stock: { $in: stockIds } }, { securityName: { $in: symbols } }],
  }).select('_id stock securityName eventTypes eventType purpose status').lean();

  const hintsByStock = new Map<string, CalendarEventHint[]>();
  for (const event of events) {
    const hint: CalendarEventHint = {
      _id: String(event._id), date: key,
      eventTypes: event.eventTypes?.length ? event.eventTypes : [event.eventType],
      purpose: event.purpose, status: event.status,
    };
    const keys = [event.stock ? `id:${String(event.stock)}` : '', `symbol:${event.securityName}`].filter(Boolean);
    for (const mapKey of keys) hintsByStock.set(mapKey, [...(hintsByStock.get(mapKey) || []), hint]);
  }

  return items.map((item) => ({
    ...item,
    stock: {
      ...item.stock,
      calendarEvents: hintsByStock.get(`id:${String(item.stock._id)}`) || hintsByStock.get(`symbol:${item.stock.symbol.toUpperCase()}`) || [],
    },
  }));
}
