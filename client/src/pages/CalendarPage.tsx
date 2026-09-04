import { CalendarDays, Filter, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CorporateEventList, eventTypeLabels } from '../components/CorporateEventList';
import { DateRangeFilter, dateRangeParams, presetDateRange, type DateRangeValue } from '../components/DateRangeFilter';
import { EmptyState, Loading } from '../components/Loading';
import { api, getApiErrorMessage } from '../services/api';
import type { CorporateEvent, CorporateEventType } from '../types';
import { formatDate } from '../utils/format';

const eventTypes = Object.keys(eventTypeLabels) as CorporateEventType[];
type CalendarSyncSummary = { eventsReceived: number; eventsUpserted: number; stocksMatched: number; revisedEvents: number; errors: number };
type CalendarSyncResponse = { summary: CalendarSyncSummary; yahoo?: { stocksAttempted: number; eventsUpserted: number; errors: number }; nse?: { eventsReceived: number; eventsUpserted: number; stocksMatched: number; errors: number } };
const sources = ['', 'BSE', 'NSE', 'YAHOO'] as const;
const sourceLabels: Record<typeof sources[number], string> = { '': 'All sources', BSE: 'BSE', NSE: 'NSE', YAHOO: 'Yahoo Finance' };

export function CalendarPage() {
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState<CorporateEvent[] | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    return from || to ? { preset: 'CUSTOM', from, to } : presetDateRange('MONTH', 'future');
  });
  const [eventType, setEventType] = useState('');
  const [source, setSource] = useState<typeof sources[number]>('');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CalendarSyncResponse | null>(null);
  const [error, setError] = useState('');

  const loadEvents = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/calendar', { params: { ...dateRangeParams(dateRange), ...(eventType ? { type: eventType } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}), limit: 5000 } });
      setEvents(data);
    } catch (requestError) { setError(getApiErrorMessage(requestError, 'Could not load the corporate calendar.')); setEvents([]); }
  }, [dateRange, eventType, source, search]);

  useEffect(() => { const timer = window.setTimeout(() => void loadEvents(), 180); return () => window.clearTimeout(timer); }, [loadEvents]);

  const syncCalendar = async () => {
    setSyncing(true); setError(''); setSyncResult(null);
    try { const { data } = await api.post<CalendarSyncResponse>('/calendar/refresh'); setSyncResult(data); await loadEvents(); }
    catch (requestError) { setError(getApiErrorMessage(requestError, 'BSE calendar sync failed.')); }
    finally { setSyncing(false); }
  };

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, CorporateEvent[]>();
    for (const event of events || []) {
      const key = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(event.eventDate));
      groups.set(key, [...(groups.get(key) || []), event]);
    }
    return [...groups.entries()];
  }, [events]);

  if (events === null) return <Loading/>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Corporate events</p><h1>Corporate Calendar</h1><p>Board meetings, earnings, dividends, mergers, capital actions, and other important company events from BSE, NSE, and Yahoo Finance.</p></div><button className="sync-button" onClick={syncCalendar} disabled={syncing}><RefreshCw size={16} className={syncing ? 'spin' : ''}/>{syncing ? 'Syncing all sources…' : 'Sync all sources'}</button></div>
    <DateRangeFilter value={dateRange} onChange={setDateRange} allowFuture direction="future"/>
    <div className="calendar-filter-bar"><span><Filter size={16}/>Event filters</span><select value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="">All event types</option>{eventTypes.map((type) => <option key={type} value={type}>{eventTypeLabels[type]}</option>)}</select><select value={source} onChange={(event) => setSource(event.target.value as typeof sources[number])}>{sources.map((value) => <option key={value} value={value}>{sourceLabels[value]}</option>)}</select><label><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, BSE code or purpose"/></label></div>
    {syncResult && <div className="sync-status success">BSE sync complete: {syncResult.summary.eventsReceived} records received, {syncResult.summary.eventsUpserted} stored, {syncResult.summary.stocksMatched} linked to MarketLens stocks, {syncResult.summary.revisedEvents} revised, {syncResult.summary.errors} errors{syncResult.yahoo ? ` · Yahoo Finance: ${syncResult.yahoo.eventsUpserted} events stored across ${syncResult.yahoo.stocksAttempted} stocks` : ''}{syncResult.nse ? ` · NSE: ${syncResult.nse.eventsUpserted} corporate actions stored` : ''}.</div>}
    {error && <div className="sync-status error">{error}</div>}
    <section className="panel calendar-panel"><div className="panel-heading"><div><h2>Event Agenda</h2><p>{events.length} events across {groupedEvents.length} dates</p></div><a href="https://www.bseindia.com/corporates/board_meeting.aspx" target="_blank" rel="noreferrer">Official BSE source ↗</a></div>
      {groupedEvents.length ? <div className="calendar-agenda">{groupedEvents.map(([date, items]) => <section className="agenda-day" key={date}><header><span><CalendarDays size={16}/></span><div><strong>{formatDate(`${date}T00:00:00+05:30`)}</strong><small>{items.length} event{items.length === 1 ? '' : 's'}</small></div></header><CorporateEventList events={items}/></section>)}</div> : <EmptyState>No events match this date range and filter.</EmptyState>}
    </section>
  </>;
}
