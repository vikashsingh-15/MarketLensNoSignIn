import { ArrowUpRight, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CorporateEvent, CorporateEventType } from '../types';
import { formatDate } from '../utils/format';

export const eventTypeLabels: Record<CorporateEventType, string> = {
  EARNINGS: 'Earnings', DIVIDEND: 'Dividend', MERGER: 'Merger / Acquisition', BUYBACK: 'Buyback',
  BONUS: 'Bonus', SPLIT: 'Stock Split', FUND_RAISE: 'Fund Raise', AGM: 'AGM', BOARD_MEETING: 'Board Meeting', OTHER: 'Other',
};

export function CorporateEventList({ events, compact = false }: { events: CorporateEvent[]; compact?: boolean }) {
  return <div className={`corporate-event-list ${compact ? 'compact' : ''}`}>
    {events.map((event) => <article className="corporate-event" key={event._id}>
      <span className={`event-icon event-${event.eventType.toLowerCase()}`}><Building2 size={16}/></span>
      <div className="event-company">
        {event.stock ? <Link to={`/stocks/${event.stock.symbol}`}>{event.securityName}</Link> : <strong>{event.securityName}</strong>}
        <small>{event.source === 'BSE' && event.bseCode ? `BSE ${event.bseCode} · ` : event.source === 'YAHOO' ? 'Yahoo Finance · ' : event.source === 'NSE' ? 'NSE · ' : ''}{formatDate(event.eventDate)}{event.dividendAmount != null ? ` · ₹${event.dividendAmount}/share` : ''}</small>
      </div>
      <div className="event-purpose"><div className="event-badges">{(event.eventTypes?.length ? event.eventTypes : [event.eventType]).map((type) => <span key={type} className={`event-badge event-${type.toLowerCase()}`}>{eventTypeLabels[type]}</span>)}</div><p>{event.purpose}</p></div>
      {event.status === 'REVISED' && <span className="revised-badge">Revised</span>}
      <a className="event-source" href={event.sourceUrl} target="_blank" rel="noreferrer" title={event.source === 'YAHOO' ? 'Open on Yahoo Finance' : event.source === 'NSE' ? 'Open on NSE' : 'Open on BSE'}>{event.source === 'YAHOO' ? 'Yahoo' : event.source === 'NSE' ? 'NSE' : 'BSE'} <ArrowUpRight size={13}/></a>
    </article>)}
  </div>;
}
