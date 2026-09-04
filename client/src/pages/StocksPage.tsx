import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Loading } from '../components/Loading';
import { api } from '../services/api';
import type { Stock } from '../types';
export function StocksPage() {
  const [stocks, setStocks] = useState<Stock[] | null>(null); const [query, setQuery] = useState('');
  useEffect(() => { api.get('/stocks').then(({ data }) => setStocks(data)); }, []);
  const filtered = useMemo(() => stocks?.filter((stock) => `${stock.symbol} ${stock.companyName}`.toLowerCase().includes(query.toLowerCase())) || [], [stocks, query]);
  if (!stocks) return <Loading/>;
  return <><div className="page-heading"><div><p className="eyebrow">Coverage universe</p><h1>Stocks</h1><p>Browse all equities tracked by MarketLens.</p></div></div><div className="search-box"><Search size={19}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by stock or company…"/></div>{filtered.length ? <div className="stock-grid">{filtered.map((stock) => <Link to={`/stocks/${stock.symbol}`} className="stock-card" key={stock.symbol}><span className="ticker-circle large">{stock.symbol.slice(0, 2)}</span><div><strong>{stock.symbol}</strong><p>{stock.companyName}</p><small>{stock.exchange}</small></div><span>→</span></Link>)}</div> : <EmptyState>No matching stocks found.</EmptyState>}</>;
}
