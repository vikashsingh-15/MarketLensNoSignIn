import { Filter } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ALL_DATE_RANGE, DateRangeFilter, dateInputValue, dateRangeParams, type DateRangeValue } from '../components/DateRangeFilter';
import { Loading } from '../components/Loading';
import { RecommendationsTable } from '../components/RecommendationsTable';
import { api } from '../services/api';
import type { Broker, Recommendation, Stock } from '../types';
export function RecommendationsPage() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<Recommendation[] | null>(null); const [stocks, setStocks] = useState<Stock[]>([]); const [brokers, setBrokers] = useState<Broker[]>([]);
  const [filters, setFilters] = useState(() => ({ stock: searchParams.get('stock') || '', broker: searchParams.get('broker') || '', recommendation: searchParams.get('recommendation') || '' }));
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    return from || to ? { preset: 'CUSTOM', from, to } : ALL_DATE_RANGE;
  });
  useEffect(() => { api.get('/stocks').then(({ data }) => setStocks(data)); api.get('/recommendations').then(({ data }) => { setItems(data); setBrokers([...new Map<string, Broker>(data.map((r: Recommendation) => [r.broker._id, r.broker])).values()].sort((a, b) => a.name.localeCompare(b.name))); }); }, []);
  useEffect(() => { if (items === null) return; const params = { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), ...dateRangeParams(dateRange), eventDate: dateRange.to || dateInputValue(new Date()) }; api.get('/recommendations', { params }).then(({ data }) => setItems(data)); }, [filters, dateRange]);
  if (!items) return <Loading/>;
  return <><div className="page-heading"><div><p className="eyebrow">Analyst activity</p><h1>Recommendations</h1><p>Browse the latest deduplicated broker calls.</p></div></div><DateRangeFilter value={dateRange} onChange={setDateRange}/><div className="filter-bar"><span><Filter size={18}/>Filters</span><select value={filters.stock} onChange={(e) => setFilters({ ...filters, stock: e.target.value })}><option value="">All stocks</option>{stocks.map((s) => <option key={s.symbol}>{s.symbol}</option>)}</select><select value={filters.broker} onChange={(e) => setFilters({ ...filters, broker: e.target.value })}><option value="">All brokers</option>{brokers.map((b) => <option key={b._id}>{b.name}</option>)}</select><select value={filters.recommendation} onChange={(e) => setFilters({ ...filters, recommendation: e.target.value })}><option value="">All ratings</option><option>BUY</option><option>HOLD</option><option>SELL</option></select></div><section className="panel"><div className="panel-heading"><div><h2>Latest Calls</h2><p>{items.length} recommendations</p></div></div><RecommendationsTable recommendations={items}/></section></>;
}
