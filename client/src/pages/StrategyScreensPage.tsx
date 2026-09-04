import { BrainCircuit, CheckCircle2, ChevronRight, CircleHelp, RefreshCw, ScanSearch, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { api, getApiErrorMessage } from '../services/api';
import type { Stock, StrategyKey, StrategyScreenOverview, StrategyScreenResult, StrategyStatus } from '../types';

const statusOrder: Record<StrategyStatus, number> = { PASS: 0, NEAR: 1, FAIL: 2, INSUFFICIENT_DATA: 3 };
const statusLabel: Record<StrategyStatus, string> = { PASS: 'Match', NEAR: 'Near match', FAIL: 'Does not match', INSUFFICIENT_DATA: 'Insufficient data' };

function CriterionIcon({ passed }: { passed: boolean | null }) {
  if (passed === true) return <CheckCircle2 className="criterion-pass" size={16}/>;
  if (passed === false) return <XCircle className="criterion-fail" size={16}/>;
  return <CircleHelp className="criterion-missing" size={16}/>;
}

function ResultCard({ result, name }: { result: StrategyScreenResult; name: string }) {
  const stock = result.stock as Stock;
  return <article className="strategy-result-card">
    <header>
      <Link to={`/stocks/${stock.symbol}`} className="strategy-stock"><span className="ticker-circle">{stock.symbol.slice(0, 2)}</span><div><strong>{stock.symbol}</strong><small>{stock.companyName}</small></div></Link>
      <span className={`strategy-status ${result.status.toLowerCase()}`}>{statusLabel[result.status]}</span>
    </header>
    <div className="strategy-score"><div><small>{name}</small><strong>{result.score}<em>/100</em></strong></div><div><small>Data coverage</small><strong>{result.dataCompleteness}%</strong></div></div>
    <div className="strategy-criteria">{result.criteria.map((item) => <div key={item.key} title={item.note || ''}><CriterionIcon passed={item.passed}/><div><strong>{item.label}</strong><span>{item.displayValue}</span><small>Target: {item.target}</small></div></div>)}</div>
    <div className="strategy-card-footer"><span>{result.yahooSymbol} · {new Date(result.asOf).toLocaleDateString('en-IN')}</span><Link to={`/stocks/${stock.symbol}`}>Open stock <ChevronRight size={14}/></Link></div>
  </article>;
}

export function StrategyScreensPage() {
  const [overview, setOverview] = useState<StrategyScreenOverview | null>(null);
  const [selected, setSelected] = useState<StrategyKey>('DEFENSIVE_VALUE');
  const [status, setStatus] = useState<'ALL' | StrategyStatus>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const { data } = await api.get<StrategyScreenOverview>('/strategy-screens', { params: { limit: 2500, strategy: selected } }); setOverview(data); setError(''); }
    catch (loadError) { setError(getApiErrorMessage(loadError, 'Strategy screens could not be loaded.')); }
    finally { setLoading(false); }
  }, [selected]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true); setError(''); setMessage('');
    try {
      const { data } = await api.post<{ completed: number; errors: unknown[] }>('/strategy-screens/refresh', { limit: 100 });
      setMessage(`Updated ${data.completed} stocks${data.errors.length ? `; ${data.errors.length} could not be fetched` : ''}.`);
      await load();
    } catch (refreshError) { setError(getApiErrorMessage(refreshError, 'The strategy scan could not be completed.')); }
    finally { setRefreshing(false); }
  };

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    overview?.counts.forEach((item) => map.set(`${item._id.strategy}:${item._id.status}`, item.count));
    return map;
  }, [overview]);
  const visible = useMemo(() => (overview?.results || [])
    .filter((item) => item.strategy === selected && (status === 'ALL' || item.status === status))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.score - a.score), [overview, selected, status]);
  const activeDefinition = overview?.strategies.find((item) => item.key === selected);

  if (loading) return <Loading/>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Rule-based equity research</p><h1>Strategy Screens</h1><p>Explainable valuation, growth, quality, and consistency checks using Yahoo Finance data.</p></div><button className="sync-button" onClick={refresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>{refreshing ? 'Updating 100 stocks…' : 'Update next batch now'}</button></div>
    {message && <div className="sync-status success">{message}</div>}
    {error && <div className="sync-status error">{error}</div>}
    {overview && <div className="strategy-coverage"><ScanSearch size={18}/><div><strong>{overview.coverage.scannedStocks} of {overview.coverage.totalStocks} stocks scanned</strong><small>{overview.lastUpdated ? `Last updated ${new Date(overview.lastUpdated).toLocaleString('en-IN')}` : 'No completed scan yet'} · Automatic 100-stock batches every 3 minutes · Daily rolling refresh after initial coverage · Manual update is optional</small></div></div>}
    <Link to="/ai-signals" className="ai-lab-banner"><span><BrainCircuit size={21}/></span><div><strong>AI &amp; Quant Signals</strong><small>Explore Mean Reversion, Multi-Factor, Trend Breakout, Smart Money, Adaptive ML, and their regime-aware consensus.</small></div><ChevronRight size={18}/></Link>

    <div className="strategy-selector">{overview?.strategies.map((strategy) => {
      const matches = (counts.get(`${strategy.key}:PASS`) || 0) + (counts.get(`${strategy.key}:NEAR`) || 0);
      return <button key={strategy.key} className={selected === strategy.key ? 'active' : ''} onClick={() => setSelected(strategy.key)}><span>{strategy.name}</span><strong>{matches}</strong><em>{strategy.inspiredBy}</em><small>{strategy.description}</small></button>;
    })}</div>

    <div className="strategy-results-heading"><div><h2>{activeDefinition?.name}</h2>{activeDefinition && <span className="strategy-inspiration">Inspired by {activeDefinition.inspiredBy}</span>}<p>{activeDefinition?.description}</p></div><div className="rating-filter">{(['ALL', 'PASS', 'NEAR', 'FAIL', 'INSUFFICIENT_DATA'] as const).map((value) => <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value === 'ALL' ? 'All' : statusLabel[value]}</button>)}</div></div>
    {visible.length ? <div className="strategy-results-grid">{visible.map((item) => <ResultCard key={item._id} result={item} name={activeDefinition?.name || item.strategy}/>)}</div> : <div className="empty-state">No stocks in the scanned universe have this status yet. Run the next batch or choose another status.</div>}
    <div className="strategy-disclaimer">The style labels describe simplified, rules-based interpretations of well-known investing principles. They are not exact replicas, endorsements, personalized advice, or claims that the named investor selected any stock. Missing Yahoo data never counts as a pass. Financial-company ratios can require sector-specific interpretation.</div>
  </>;
}
