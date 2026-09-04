import type { Request, Response } from 'express';
import { CorporateEvent, corporateEventTypes } from '../models/CorporateEvent.js';
import { Stock } from '../models/Stock.js';
import { runCalendarRefresh } from '../services/calendar/calendarRefresh.service.js';
import { getRecommendationDateRange, parseIstDateOnly } from '../utils/recommendationDate.js';

const readLimit = (value: unknown, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
};

export async function listCalendarEvents(req: Request, res: Response) {
  const filter: Record<string, unknown> = {};
  const clauses: Record<string, unknown>[] = [];
  const range = getRecommendationDateRange(req.query);
  if (range) filter.eventDate = range;
  const eventType = String(req.query.type || '').toUpperCase();
  if (corporateEventTypes.includes(eventType as (typeof corporateEventTypes)[number])) filter.eventTypes = eventType;
  const source = String(req.query.source || '').toUpperCase();
  if (source === 'BSE' || source === 'YAHOO' || source === 'NSE') filter.source = source;
  if (req.query.stock) {
    const symbol = String(req.query.stock).toUpperCase();
    const stock = await Stock.findOne({ symbol }).select('_id').lean();
    clauses.push({ $or: [{ stock: stock?._id || null }, { securityName: symbol }] });
  }
  const search = String(req.query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clauses.push({ $or: [{ securityName: { $regex: escaped, $options: 'i' } }, { bseCode: escaped }, { purpose: { $regex: escaped, $options: 'i' } }] });
  }
  if (clauses.length) filter.$and = clauses;

  const events = await CorporateEvent.find(filter)
    .sort({ eventDate: 1, securityName: 1 })
    .limit(readLimit(req.query.limit, 1000, 5000))
    .populate('stock')
    .lean();
  res.json(events);
}

export async function focusEvents(req: Request, res: Response) {
  const requestedDate = String(req.query.date || '');
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata',
  }).format(new Date());
  const date = parseIstDateOnly(requestedDate, false) || parseIstDateOnly(todayKey, false)!;
  const end = new Date(date.getTime() + 86_400_000 - 1);
  const events = await CorporateEvent.find({ eventDate: { $gte: date, $lte: end } })
    .sort({ securityName: 1 })
    .populate('stock')
    .lean();
  const priority = ['EARNINGS', 'MERGER', 'DIVIDEND', 'BUYBACK', 'BONUS', 'SPLIT', 'FUND_RAISE', 'AGM', 'BOARD_MEETING'];
  events.sort((left, right) => priority.indexOf(left.eventType) - priority.indexOf(right.eventType) || left.securityName.localeCompare(right.securityName));
  res.json({ date: requestedDate || todayKey, events, total: events.length });
}

export async function refreshCalendar(_req: Request, res: Response) {
  res.json(await runCalendarRefresh());
}
