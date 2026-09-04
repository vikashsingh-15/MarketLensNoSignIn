import { BarChart3, Building2, CalendarDays, RefreshCw, ShoppingCart, TrendingDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CorporateEventList } from '../components/CorporateEventList';
import { ALL_DATE_RANGE, DateRangeFilter, dateInputValue, dateRangeParams, type DateRangeValue } from '../components/DateRangeFilter';
import { EmptyState, Loading } from '../components/Loading';
import { MarketMoodGauge } from '../components/MarketMoodGauge';
import { MarketNewsHighlights } from '../components/MarketNewsHighlights';
import { RecommendationsTable } from '../components/RecommendationsTable';
import { StatCard } from '../components/StatCard';
import { api, getApiErrorMessage } from '../services/api';
import type { CalendarFocus, DashboardData } from '../types';

type SyncSummary = {
  publishers: number; feedsAttempted: number; feedsCompleted: number; feedItems: number; webItems: number;
  sentimentAnalyzed: number; sentimentFallbacks: number; recommendationsCreated: number; duplicates: number;
  normalizationMisses: number; errors: number;
};
type CalendarSyncSummary = { eventsReceived: number; eventsUpserted: number; stocksMatched: number; revisedEvents: number; errors: number };
type CalendarRefreshResponse = { message: string; summary: CalendarSyncSummary; yahoo?: { stocksAttempted: number; eventsUpserted: number; errors: number }; nse?: { eventsReceived: number; eventsUpserted: number; stocksMatched: number; errors: number } };
type RefreshTaskStatus<T> = { state: 'idle' | 'running' | 'succeeded' | 'failed'; startedAt: string | null; completedAt: string | null; result: T | null; error: string | null };
type DashboardRefreshStatus = {
  recommendations: RefreshTaskStatus<SyncSummary>;
  news: RefreshTaskStatus<SyncSummary>;
  calendar: RefreshTaskStatus<CalendarRefreshResponse>;
};
type RefreshScope = keyof DashboardRefreshStatus;
type RefreshSection = 'hot' | 'latest' | 'strong' | 'focus' | 'mood' | 'news';

const sectionScope: Record<RefreshSection, RefreshScope> = {
  hot: 'recommendations', latest: 'recommendations', strong: 'recommendations',
  focus: 'calendar', mood: 'news', news: 'news',
};
const allSections = Object.keys(sectionScope) as RefreshSection[];
const sourceDate = (value: string | null) => value
  ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'No validated broker calls yet';

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshingSections, setRefreshingSections] = useState<RefreshSection[]>([]);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_DATE_RANGE);
  const [focusDate, setFocusDate] = useState(() => dateInputValue(new Date()));
  const [focus, setFocus] = useState<CalendarFocus | null>(null);

  const loadDashboard = useCallback(async () => {
    const response = await api.get('/dashboard', { params: { ...dateRangeParams(dateRange), eventDate: focusDate } });
    setData(response.data);
  }, [dateRange, focusDate]);

  const loadFocus = useCallback(async () => {
    try {
      const { data: focusData } = await api.get<CalendarFocus>('/calendar/focus', { params: { date: focusDate } });
      setFocus(focusData);
    } catch { setFocus({ date: focusDate, events: [], total: 0 }); }
  }, [focusDate]);

  useEffect(() => {
    void loadDashboard();
    const timer = window.setInterval(() => void loadDashboard(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  useEffect(() => { void loadFocus(); }, [loadFocus]);

  const startRefresh = async (section: RefreshSection | 'all') => {
    const sections = section === 'all' ? allSections : [section];
    const scope = section === 'all' ? 'all' : sectionScope[section];
    setSyncError('');
    setSyncMessage('');
    try {
      const response = await api.post<{ message: string }>(`/dashboard/refresh/${scope}`);
      setRefreshingSections((current) => [...new Set([...current, ...sections])]);
      setSyncMessage(`${response.data.message} You can keep using the dashboard while it runs.`);
    } catch (error: unknown) {
      setSyncError(getApiErrorMessage(error, 'The refresh could not be started. Check the backend console for details.'));
    }
  };

  useEffect(() => {
    if (!refreshingSections.length) return;
    let cancelled = false;

    const checkProgress = async () => {
      try {
        const { data: status } = await api.get<DashboardRefreshStatus>('/dashboard/refresh/status');
        if (cancelled) return;
        const requestedScopes = [...new Set(refreshingSections.map((section) => sectionScope[section]))];
        const completedScopes = requestedScopes.filter((scope) => status[scope].state !== 'running');
        if (!completedScopes.length) return;

        const failures = completedScopes.filter((scope) => status[scope].state !== 'succeeded');
        const successes = completedScopes.filter((scope) => status[scope].state === 'succeeded');
        if (successes.some((scope) => scope === 'recommendations' || scope === 'news')) await loadDashboard();
        if (successes.includes('calendar')) await Promise.all([loadFocus(), loadDashboard()]);

        const messages: string[] = [];
        if (successes.includes('recommendations')) {
          const result = status.recommendations.result;
          messages.push(`Recommendations updated: ${result?.webItems || 0} source calls checked, ${result?.recommendationsCreated || 0} new calls, ${result?.duplicates || 0} already stored.`);
        }
        if (successes.includes('news')) {
          const result = status.news.result;
          messages.push(`Market news updated: ${result?.feedsCompleted || 0}/${result?.feedsAttempted || 0} feeds completed and ${result?.feedItems || 0} items checked.`);
        }
        if (successes.includes('calendar')) {
          const result = status.calendar.result;
          messages.push(`Focus calendar updated: ${result?.summary.eventsUpserted || 0} BSE events stored.`);
        }
        if (messages.length) setSyncMessage(messages.join(' '));
        if (failures.length) {
          const details = failures.map((scope) => status[scope].error || `${scope} refresh did not complete`).join('; ');
          setSyncError(`Some refreshes failed: ${details}`);
        }
        setRefreshingSections((current) => current.filter((section) => !completedScopes.includes(sectionScope[section])));
      } catch (error: unknown) {
        if (!cancelled) setSyncError(getApiErrorMessage(error, 'Could not read refresh progress. The background job may still be running.'));
      }
    };

    const firstCheck = window.setTimeout(() => void checkProgress(), 750);
    const timer = window.setInterval(() => void checkProgress(), 2_500);
    return () => { cancelled = true; window.clearTimeout(firstCheck); window.clearInterval(timer); };
  }, [refreshingSections, loadDashboard, loadFocus]);

  const isRefreshing = (section: RefreshSection) => refreshingSections.includes(section);
  const refreshButton = (section: RefreshSection) => <button type="button" className="panel-refresh-button" onClick={() => void startRefresh(section)} disabled={isRefreshing(section)}><RefreshCw size={13} className={isRefreshing(section) ? 'spin' : ''}/>{isRefreshing(section) ? 'Updating…' : 'Refresh'}</button>;

  if (!data) return <Loading/>;
  const latestCallDate = sourceDate(data.freshness.latestRecommendationDate);
  const recommendationListUrl = (recommendation?: 'BUY' | 'SELL', todayOnly = false) => {
    const params = new URLSearchParams();
    const range = todayOnly ? { from: dateInputValue(new Date()), to: dateInputValue(new Date()) } : dateRange;
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    if (recommendation) params.set('recommendation', recommendation);
    const query = params.toString();
    return `/recommendations${query ? `?${query}` : ''}`;
  };
  return <>
    <div className="page-heading"><div><p className="eyebrow">Market overview</p><h1>Dashboard</h1><p>Validated broker recommendations extracted from financial publishers.</p></div><button className="sync-button" onClick={() => void startRefresh('all')} disabled={refreshingSections.length > 0}><RefreshCw size={16} className={refreshingSections.length ? 'spin' : ''}/>{refreshingSections.length ? 'Refreshing selected sections…' : 'Refresh all sections'}</button></div>
    <DateRangeFilter value={dateRange} onChange={setDateRange}/>
    <div className="data-freshness"><strong>Latest publisher call: {latestCallDate}</strong><span>Recommendation dates come from the broker report. Refreshing does not change an older call to today unless a publisher releases a newer validated recommendation.</span></div>
    {syncMessage && <div className="sync-status success">{syncMessage}</div>}
    {syncError && <div className="sync-status error">{syncError}</div>}
    <div className="stats-grid">
      <StatCard label="Recommendations Today" value={data.summary.recommendationsToday} icon={BarChart3} to={recommendationListUrl(undefined, true)}/>
      <StatCard label="Stocks Covered" value={data.summary.stocksCovered} icon={Building2} tone="violet" to="/stocks"/>
      <StatCard label="Buy Recommendations" value={data.summary.buyRecommendations} icon={ShoppingCart} tone="green" to={recommendationListUrl('BUY')}/>
      <StatCard label="Sell Recommendations" value={data.summary.sellRecommendations} icon={TrendingDown} tone="red" to={recommendationListUrl('SELL')}/>
    </div>
    <div className="market-intelligence-grid"><MarketMoodGauge mood={data.marketMood} hotStocks={data.hotStocks.slice(0, 10)} latestRecommendationDate={data.freshness.latestRecommendationDate} onRefreshMood={() => void startRefresh('mood')} onRefreshHotStocks={() => void startRefresh('hot')} refreshingMood={isRefreshing('mood')} refreshingHotStocks={isRefreshing('hot')}/><MarketNewsHighlights data={data.marketNews} onRefresh={() => void startRefresh('news')} refreshing={isRefreshing('news')}/></div>
    <div className="dashboard-split"><section className="panel"><div className="panel-heading"><div><h2>Strong Buy Consensus</h2><p>Stocks with at least 60% BUY ratings · Calls through {latestCallDate}</p></div>{refreshButton('strong')}</div>{data.strongBuys.length ? <div className="consensus-list">{data.strongBuys.map((item) => <Link to={`/stocks/${item.stock.symbol}`} key={item.stock.symbol}><span className="ticker-circle">{item.stock.symbol.slice(0, 2)}</span><div><strong>{item.stock.symbol}</strong><small>{item.stock.companyName}</small></div><div className="percent"><strong>{item.buyPercentage}%</strong><small>BUY</small></div></Link>)}</div> : <EmptyState>No BUY consensus is available yet.</EmptyState>}</section>
      <section className="panel latest-panel"><div className="panel-heading"><div><h2>Latest Recommendations</h2><p>Newest validated analyst calls · Latest source date {latestCallDate}</p></div><div className="panel-actions">{refreshButton('latest')}<Link to="/recommendations">View all →</Link></div></div>{data.latest.length ? <RecommendationsTable recommendations={data.latest.slice(0, 5)}/> : <EmptyState>No recommendations have been extracted yet.</EmptyState>}</section></div>
    <section className="panel focus-panel"><div className="panel-heading"><div><h2>Focus for Today</h2><p>Important BSE corporate events for the selected date</p></div><div className="focus-date"><CalendarDays size={15}/><input type="date" value={focusDate} onChange={(event) => setFocusDate(event.target.value)}/><button type="button" onClick={() => setFocusDate(dateInputValue(new Date()))}>Today</button>{refreshButton('focus')}<Link to="/calendar">Full calendar →</Link></div></div>{focus?.events.length ? <CorporateEventList events={focus.events.slice(0, 12)} compact/> : <EmptyState>{focus ? 'No BSE corporate events are scheduled for this date.' : 'Loading corporate events…'}</EmptyState>}</section>
  </>;
}
