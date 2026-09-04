import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Stock } from '../types';
import { eventTypeLabels } from './CorporateEventList';

export function StockEventIndicator({ stock }: { stock: Stock }) {
  const events = stock.calendarEvents || [];
  if (!events.length) return null;
  const date = events[0].date;
  const details = events.map((event) => {
    const labels = event.eventTypes.map((type) => eventTypeLabels[type]).join(', ');
    return `${labels}: ${event.purpose}${event.status === 'REVISED' ? ' (revised)' : ''}`;
  }).join('\n');
  const params = new URLSearchParams({ from: date, to: date, search: stock.symbol });

  return <Link
    className="stock-event-indicator"
    to={`/calendar?${params.toString()}`}
    title={`Expected event on ${date}\n${details}`}
    aria-label={`${events.length} expected calendar event${events.length === 1 ? '' : 's'} for ${stock.symbol} on ${date}`}
  >
    <CalendarDays size={14}/>{events.length > 1 && <span>{events.length}</span>}
  </Link>;
}
