import { useEffect, useState } from 'react';
import { ConsensusFilter, type ConsensusFilterValue } from '../components/ConsensusFilter';
import { ALL_DATE_RANGE, DateRangeFilter, dateInputValue, dateRangeParams, type DateRangeValue } from '../components/DateRangeFilter';
import { HotStocksTable } from '../components/HotStocksTable';
import { EmptyState, Loading } from '../components/Loading';
import { api } from '../services/api';
import type { Analytics } from '../types';
export function HotStocksPage() {
  const [stocks, setStocks] = useState<Analytics[] | null>(null);
  const [filter, setFilter] = useState<ConsensusFilterValue>('ALL');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_DATE_RANGE);
  useEffect(() => { api.get('/dashboard/hot-stocks', { params: { ...dateRangeParams(dateRange), eventDate: dateRange.to || dateInputValue(new Date()) } }).then(({ data }) => setStocks(data)); }, [dateRange]);
  if (!stocks) return <Loading/>;
  const filteredStocks = filter === 'ALL' ? stocks : stocks.filter((stock) => stock.consensus === filter);
  return <><div className="page-heading"><div><p className="eyebrow">Broker breadth</p><h1>Hot Stocks</h1><p>Ranked by the number of unique brokers publishing a recommendation.</p></div></div><DateRangeFilter value={dateRange} onChange={setDateRange}/><div className="hot-stock-filter-bar"><ConsensusFilter value={filter} onChange={setFilter}/><span>{filteredStocks.length} stocks</span></div><section className="panel">{filteredStocks.length ? <HotStocksTable stocks={filteredStocks}/> : <EmptyState>{`No ${filter} consensus stocks are available.`}</EmptyState>}</section></>;
}
