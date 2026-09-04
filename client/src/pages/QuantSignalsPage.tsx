import { BrainCircuit, ChevronRight, Database, RefreshCw, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { api, getApiErrorMessage } from '../services/api';
import type { QuantEngineKey, QuantSignal, QuantSignalOverview, QuantSignalResult, Stock } from '../types';

type EngineSelection = QuantEngineKey | 'META';
const signalLabels: Record<QuantSignal, string> = { STRONG_BUY: 'Strong Buy', BUY: 'Buy', HOLD: 'Hold', SELL: 'Sell', STRONG_SELL: 'Strong Sell', INSUFFICIENT_DATA: 'Insufficient Data' };
const signalOrder: Record<QuantSignal, number> = { STRONG_BUY: 0, BUY: 1, HOLD: 2, SELL: 3, STRONG_SELL: 4, INSUFFICIENT_DATA: 5 };

function signalClass(signal: QuantSignal) { return signal.toLowerCase(); }
function signedScore(score: number) { return `${score > 0 ? '+' : ''}${score.toFixed(2)}`; }

function QuantCard({ result, selected }: { result: QuantSignalResult; selected: EngineSelection }) {
  const stock = result.stock as Stock;
  const engine = selected === 'META' ? null : result.engines.find((item) => item.key === selected) || null;
  const signal = engine?.signal || result.meta.signal; const score = engine?.score ?? result.meta.score; const confidence = engine?.confidence ?? result.meta.confidence;
  const evidence = engine?.evidence || result.engines.filter((item) => item.signal !== 'INSUFFICIENT_DATA').sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3).map((item) => `${item.name}: ${signalLabels[item.signal]}`);
  return <article className="quant-result-card">
    <header><Link to={`/stocks/${stock.symbol}`} className="strategy-stock"><span className="ticker-circle">{stock.symbol.slice(0, 2)}</span><div><strong>{stock.symbol}</strong><small>{stock.companyName}</small></div></Link><span className={`quant-signal ${signalClass(signal)}`}>{signalLabels[signal]}</span></header>
    <div className="quant-score-row"><div><small>Engine score</small><strong>{signedScore(score)}<em>/ ±2</em></strong></div><div><small>Confidence</small><strong>{confidence}%</strong></div><div><small>Market regime</small><strong>{result.meta.regime}</strong></div></div>
    {engine ? <div className="quant-metrics">{engine.metrics.slice(0, 5).map((item) => <div key={item.key}><small>{item.label}</small><strong>{item.displayValue}</strong><span>{item.interpretation}</span></div>)}</div> : <div className="quant-engine-votes">{result.engines.map((item) => <span key={item.key}><small>{item.name}</small><strong className={signalClass(item.signal)}>{signalLabels[item.signal]}</strong><em>{Math.round((result.meta.weights.find((weight) => weight.engine === item.key)?.weight || 0) * 100)}% weight</em></span>)}</div>}
    {evidence.length > 0 && <div className="quant-evidence"><strong>Why this signal</strong>{evidence.map((item) => <p key={item}>{item}</p>)}</div>}
    {selected === 'ML_ENSEMBLE' && <div className="ml-diagnostics"><span><small>Training</small>{result.mlDiagnostics.trainingSamples} samples</span><span><small>Validation</small>{result.mlDiagnostics.validationSamples} samples</span><span><small>Balanced accuracy</small>{result.mlDiagnostics.validationAccuracy == null ? '—' : `${(result.mlDiagnostics.validationAccuracy * 100).toFixed(1)}%`}</span></div>}
    <div className="quant-card-footer"><span>{result.candleCount} daily candles · {new Date(result.latestCandleDate).toLocaleDateString('en-IN')}</span><Link to={`/stocks/${stock.symbol}`}>Open analysis <ChevronRight size={14}/></Link></div>
  </article>;
}

export function QuantSignalsPage() {
  const [overview, setOverview] = useState<QuantSignalOverview | null>(null);
  const [selected, setSelected] = useState<EngineSelection>('META');
  const [signal, setSignal] = useState<'ALL' | QuantSignal>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const { data } = await api.get<QuantSignalOverview>('/quant-signals', { params: { engine: selected, limit: 2500 } }); setOverview(data); setError(''); }
    catch (loadError) { setError(getApiErrorMessage(loadError, 'AI and quantitative signals could not be loaded.')); }
    finally { setLoading(false); }
  }, [selected]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(timer); }, [load]);

  const visible = useMemo(() => (overview?.results || []).filter((result) => {
    const currentSignal = selected === 'META' ? result.meta.signal : result.engines.find((item) => item.key === selected)?.signal;
    return signal === 'ALL' || currentSignal === signal;
  }).sort((a, b) => {
    const aSignal = selected === 'META' ? a.meta.signal : a.engines.find((item) => item.key === selected)?.signal || 'INSUFFICIENT_DATA';
    const bSignal = selected === 'META' ? b.meta.signal : b.engines.find((item) => item.key === selected)?.signal || 'INSUFFICIENT_DATA';
    return signalOrder[aSignal] - signalOrder[bSignal] || (selected === 'META' ? b.meta.score - a.meta.score : (b.engines.find((item) => item.key === selected)?.score || 0) - (a.engines.find((item) => item.key === selected)?.score || 0));
  }), [overview, selected, signal]);
  const countFor = (engine: EngineSelection) => engine === 'META'
    ? overview?.metaCounts.filter((item) => ['STRONG_BUY', 'BUY'].includes(item._id)).reduce((sum, item) => sum + item.count, 0) || 0
    : overview?.engineCounts.filter((item) => item._id.engine === engine && ['STRONG_BUY', 'BUY'].includes(item._id.signal)).reduce((sum, item) => sum + item.count, 0) || 0;

  if (loading) return <Loading/>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Systematic research laboratory</p><h1>AI &amp; Quant Signals</h1><p>Five independent engines plus a market-regime-aware consensus. Every output remains inspectable.</p></div><Link className="secondary-button" to="/strategy-screens"><RefreshCw size={15}/>Investor-style screens</Link></div>
    {error && <div className="sync-status error">{error}</div>}
    {overview && <div className="strategy-coverage"><Database size={18}/><div><strong>{overview.coverage.scannedStocks} of {overview.coverage.totalStocks} stocks calculated</strong><small>{overview.lastUpdated ? `Last updated ${new Date(overview.lastUpdated).toLocaleString('en-IN')}` : 'No signals calculated yet'} · Updated by the same automatic and on-demand scanner</small></div></div>}
    <div className="quant-engine-selector">{overview?.engines.map((engine) => <button key={engine.key} onClick={() => setSelected(engine.key)} className={selected === engine.key ? 'active' : ''}><span>{engine.key === 'META' ? <BrainCircuit size={18}/> : <strong>{overview.engines.findIndex((item) => item.key === engine.key)}</strong>}</span><div><b>{engine.name}</b><small>{engine.description}</small></div><em>{countFor(engine.key)} bullish</em></button>)}</div>
    <div className="quant-toolbar"><div><h2>{overview?.engines.find((item) => item.key === selected)?.name}</h2><p>{visible.length} calculated signals</p></div><div className="rating-filter">{(['ALL', 'STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL', 'INSUFFICIENT_DATA'] as const).map((value) => <button key={value} className={signal === value ? 'active' : ''} onClick={() => setSignal(value)}>{value === 'ALL' ? 'All' : signalLabels[value]}</button>)}</div></div>
    {visible.length ? <div className="quant-results-grid">{visible.map((result) => <QuantCard key={result._id} result={result} selected={selected}/>)}</div> : <div className="empty-state">No calculated stocks match this filter yet. The background scanner will fill this section automatically.</div>}
    <div className="quant-disclaimer"><ShieldAlert size={15}/><span>These are experimental mechanical research signals—not personalized recommendations or predictions. Validation accuracy is historical and can decay. Transaction costs, taxes, liquidity, slippage, corporate actions, and regime changes can materially alter outcomes.</span></div>
  </>;
}
