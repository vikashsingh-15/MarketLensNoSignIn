import { Activity, BrainCircuit, ChevronDown, ChevronUp, Gauge, RefreshCw, ShieldCheck, Target, Users, WalletCards } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ALL_DATE_RANGE, DateRangeFilter, dateInputValue, dateRangeParams, type DateRangeValue } from '../components/DateRangeFilter';
import { Loading } from '../components/Loading';
import { RecommendationBadge } from '../components/RecommendationBadge';
import { RecommendationsTable } from '../components/RecommendationsTable';
import { NewsSentimentFeed } from '../components/NewsSentimentFeed';
import { api, getApiErrorMessage } from '../services/api';
import type { Analytics, QuantSignal, QuantSignalResult, Recommendation, Stock, StockAdvancedMarketData, StockMarketData, StockNewsSentiment, StrategyKey, StrategyScreenResult } from '../types';
import { formatCurrency } from '../utils/format';

const hasNumber = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const dash = '—';

function marketCurrency(value: number | null | undefined, currency = 'INR', compact = false) {
  if (!hasNumber(value)) return dash;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 2 : 2,
  }).format(value);
}

const decimalPercent = (value: number | null | undefined) => hasNumber(value) ? `${(value * 100).toFixed(1)}%` : dash;
const percentPoints = (value: number | null | undefined) => hasNumber(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : dash;
const ratio = (value: number | null | undefined, suffix = 'x') => hasNumber(value) ? `${value.toFixed(2)}${suffix}` : dash;
const compactNumber = (value: number | null | undefined) => hasNumber(value) ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : dash;
const strategyNames: Record<StrategyKey, string> = { DEFENSIVE_VALUE: 'Defensive Value', GROWTH_AT_VALUE: 'Growth at a Fair Price', ASSET_BARGAIN: 'Asset Bargain', TOTAL_RETURN_VALUE: 'Total Return Value', QUALITY_COMPOUNDER: 'Quality Compounder', CONSISTENT_COMPOUNDER: 'Consistent Compounder' };
const quantSignalLabels: Record<QuantSignal, string> = { STRONG_BUY: 'Strong Buy', BUY: 'Buy', HOLD: 'Hold', SELL: 'Sell', STRONG_SELL: 'Strong Sell', INSUFFICIENT_DATA: 'Insufficient Data' };

function QualityCard({ label, value, description }: { label: string; value: ReactNode; description: string }) {
  return <article className="quality-card"><small>{label}</small><strong>{value}</strong><p>{description}</p></article>;
}

export function StockDetailsPage() {
  const { symbol = '' } = useParams();
  const [data, setData] = useState<{ stock: Stock; analytics: Analytics | null } | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [marketData, setMarketData] = useState<StockMarketData | null>(null);
  const [marketError, setMarketError] = useState('');
  const [newsSentiment, setNewsSentiment] = useState<StockNewsSentiment | null>(null);
  const [newsError, setNewsError] = useState('');
  const [advanced, setAdvanced] = useState<StockAdvancedMarketData | null>(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [advancedError, setAdvancedError] = useState('');
  const [strategyScreens, setStrategyScreens] = useState<StrategyScreenResult[]>([]);
  const [strategyLoading, setStrategyLoading] = useState(true);
  const [strategyError, setStrategyError] = useState('');
  const [quantResult, setQuantResult] = useState<QuantSignalResult | null>(null);
  const [quantLoading, setQuantLoading] = useState(true);
  const [quantError, setQuantError] = useState('');
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_DATE_RANGE);

  useEffect(() => {
    const params = { ...dateRangeParams(dateRange), eventDate: dateRange.to || dateInputValue(new Date()) };
    Promise.all([api.get(`/stocks/${symbol}`, { params }), api.get(`/stocks/${symbol}/recommendations`, { params })])
      .then(([stock, recs]) => { setData(stock.data); setRecommendations(recs.data); });
  }, [symbol, dateRange]);

  useEffect(() => {
    setMarketData(null); setMarketError(''); setAdvanced(null); setAdvancedError('');
    api.get(`/stocks/${symbol}/market-data`)
      .then(({ data: response }) => setMarketData(response))
      .catch((error) => setMarketError(getApiErrorMessage(error, `Market data is unavailable for ${symbol}.`)));
  }, [symbol]);

  useEffect(() => {
    setNewsSentiment(null); setNewsError('');
    api.get<StockNewsSentiment>(`/stocks/${symbol}/news-sentiment`)
      .then(({ data: response }) => setNewsSentiment(response))
      .catch((error) => setNewsError(getApiErrorMessage(error, `News sentiment is unavailable for ${symbol}.`)));
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    const loadQuantSignals = async () => {
      setQuantLoading(true); setQuantError(''); setQuantResult(null);
      try {
        let saved: QuantSignalResult | null = null;
        try { saved = (await api.get<QuantSignalResult>(`/quant-signals/stock/${symbol}`)).data; } catch { saved = null; }
        if (saved && new Date(saved.asOf).getTime() >= Date.now() - 24 * 60 * 60 * 1000) {
          if (!cancelled) setQuantResult(saved);
          return;
        }
        await api.post(`/strategy-screens/stock/${symbol}/refresh`);
        const { data: refreshed } = await api.get<QuantSignalResult>(`/quant-signals/stock/${symbol}`);
        if (!cancelled) setQuantResult(refreshed);
      } catch (error) {
        if (!cancelled) setQuantError(getApiErrorMessage(error, `AI and quantitative signals are temporarily unavailable for ${symbol}.`));
      } finally { if (!cancelled) setQuantLoading(false); }
    };
    void loadQuantSignals();
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    const loadStrategyScreens = async () => {
      setStrategyLoading(true); setStrategyError(''); setStrategyScreens([]);
      try {
        const { data: saved } = await api.get<StrategyScreenResult[]>(`/strategy-screens/stock/${symbol}`);
        if (cancelled) return;
        setStrategyScreens(saved);
        const newest = saved.reduce((latest, item) => Math.max(latest, new Date(item.asOf).getTime()), 0);
        const needsRefresh = saved.length === 0 || newest < Date.now() - 24 * 60 * 60 * 1000;
        if (needsRefresh) {
          const { data: refreshed } = await api.post<StrategyScreenResult[]>(`/strategy-screens/stock/${symbol}/refresh`);
          if (!cancelled) setStrategyScreens(refreshed);
        }
      } catch (error) {
        if (!cancelled) setStrategyError(getApiErrorMessage(error, `Strategy screening is temporarily unavailable for ${symbol}.`));
      } finally { if (!cancelled) setStrategyLoading(false); }
    };
    void loadStrategyScreens();
    return () => { cancelled = true; };
  }, [symbol]);

  const loadAdvanced = async () => {
    setAdvancedLoading(true); setAdvancedError('');
    try { const { data: response } = await api.get(`/stocks/${symbol}/market-data/advanced`); setAdvanced(response); }
    catch (error) { setAdvancedError(getApiErrorMessage(error, `Advanced metrics are unavailable for ${symbol}.`)); }
    finally { setAdvancedLoading(false); }
  };

  if (!data) return <Loading/>;
  const a = data.analytics;
  const chart = [
    { name: 'BUY', value: a?.buyCount || 0, color: '#16a66a' },
    { name: 'HOLD', value: a?.holdCount || 0, color: '#d5a022' },
    { name: 'SELL', value: a?.sellCount || 0, color: '#e14f4f' },
  ];
  const publisherCount = new Set(recommendations.flatMap((item) => [...(item.articles || []), ...(item.article ? [item.article] : [])].map((article) => article.publisher?._id).filter(Boolean))).size;
  const priceChangePositive = (marketData?.changePercent || 0) >= 0;
  const rangePosition = marketData?.rangePositionPercent == null ? 0 : Math.max(0, Math.min(100, marketData.rangePositionPercent));
  const dayRangePosition = marketData?.dayRangePositionPercent == null ? 0 : Math.max(0, Math.min(100, marketData.dayRangePositionPercent));
  const trend = marketData?.yahooRecommendation.trend;

  return <>
    <div className="stock-hero"><div><div className="stock-title"><span className="ticker-circle large">{data.stock.symbol.slice(0, 2)}</span><div><h1>{data.stock.symbol}</h1><p>{data.stock.companyName} · {data.stock.exchange}</p></div></div></div>{marketData && <div className="hero-market-price"><small>Market price</small><strong>{marketCurrency(marketData.currentPrice, marketData.currency)}</strong><span className={priceChangePositive ? 'buy-text' : 'sell-text'}>{percentPoints(marketData.changePercent == null ? null : marketData.changePercent * 100)}</span></div>}</div>

    {marketError && <div className="sync-status error">{marketError}</div>}
    {!marketData && !marketError && <section className="panel"><div className="market-data-loading"><span className="spinner"/>Loading Yahoo Finance market data…</div></section>}

    {marketData && <>
      <section className="panel market-snapshot-panel">
        <div className="panel-heading"><div><h2>Market &amp; Valuation</h2><p>{marketData.yahooSymbol} · {marketData.exchangeDelayMinutes ? `${marketData.exchangeDelayMinutes}-minute delayed quote` : 'latest available quote'}</p></div><span className={`data-provider${marketData.cache.quote.stale ? ' stale' : ''}`}>{marketData.cache.quote.stale ? 'Stale DB fallback' : 'DB-cached Yahoo Finance'}</span></div>
        <div className="market-metrics-grid">
          <article className="market-metric primary"><small>Current Price</small><strong>{marketCurrency(marketData.currentPrice, marketData.currency)}</strong><span className={priceChangePositive ? 'buy-text' : 'sell-text'}>{hasNumber(marketData.change) ? `${marketData.change >= 0 ? '+' : ''}${marketData.change.toFixed(2)} (${percentPoints(marketData.changePercent == null ? null : marketData.changePercent * 100)})` : dash}</span></article>
          <article className="market-metric"><small>Trailing P/E</small><strong>{ratio(marketData.trailingPE)}</strong><p>Price versus reported earnings</p></article>
          <article className="market-metric"><small>Forward P/E</small><strong>{ratio(marketData.forwardPE)}</strong><p>Price versus forecast earnings</p></article>
          <article className="market-metric"><small>Market Cap</small><strong>{marketCurrency(marketData.marketCap, marketData.currency, true)}</strong><p>Company size and liquidity context</p></article>
          <article className="market-metric target"><small>Consensus Target</small><strong>{marketCurrency(marketData.analystTarget.mean, marketData.currency)}</strong><span className={(marketData.analystTarget.upsidePercent || 0) >= 0 ? 'buy-text' : 'sell-text'}>{percentPoints(marketData.analystTarget.upsidePercent)} upside/downside</span><p>{marketData.analystTarget.analystCount ?? 0} Yahoo analyst opinions</p></article>
          <article className="market-metric range"><small>52-Week Range</small><div className="range-track"><span style={{ left: `${rangePosition}%` }}/></div><div className="range-labels"><em>{marketCurrency(marketData.fiftyTwoWeekLow, marketData.currency)}</em><strong>{rangePosition.toFixed(0)}%</strong><em>{marketCurrency(marketData.fiftyTwoWeekHigh, marketData.currency)}</em></div><p>{rangePosition < 35 ? 'Trading nearer its 52-week low' : rangePosition > 65 ? 'Trading nearer its 52-week high' : 'Trading near the middle of its yearly range'}</p></article>
          <article className="market-metric day-range"><small>Day Range &amp; Volume</small><div className="range-track"><span style={{ left: `${dayRangePosition}%` }}/></div><div className="range-labels"><em>{marketCurrency(marketData.dayLow, marketData.currency)}</em><strong>{dayRangePosition.toFixed(0)}%</strong><em>{marketCurrency(marketData.dayHigh, marketData.currency)}</em></div><p>Volume {compactNumber(marketData.volume)} shares · Avg {compactNumber(marketData.averageVolume)}</p></article>
        </div>
        <div className="yahoo-trend"><div><small>Yahoo Analyst Opinion</small><strong>{marketData.yahooRecommendation.key?.replaceAll('_', ' ') || 'Not available'}</strong><p>A separate opinion from MarketLens broker consensus</p></div>{trend ? <div className="trend-tally"><span className="strong-buy"><b>{trend.strongBuy}</b>Strong Buy</span><span className="buy"><b>{trend.buy}</b>Buy</span><span className="hold"><b>{trend.hold}</b>Hold</span><span className="sell"><b>{trend.sell}</b>Sell</span><span className="strong-sell"><b>{trend.strongSell}</b>Strong Sell</span></div> : <span className="metric-unavailable">No analyst trend available</span>}</div>
      </section>

      <section className="panel quality-panel">
        <div className="panel-heading"><div><h2>Business Quality Checks</h2><p>Fundamentals that can strengthen or weaken a recommendation</p></div><ShieldCheck size={19}/></div>
        <div className="quality-grid">
          <QualityCard label="Return on Equity" value={decimalPercent(marketData.quality.returnOnEquity)} description="Efficiency turning shareholder capital into profit."/>
          <QualityCard label="Debt to Equity" value={ratio(marketData.quality.debtToEquityRatio)} description="Leverage risk; lower is generally more resilient."/>
          <QualityCard label="Free Cash Flow" value={marketCurrency(marketData.quality.freeCashFlow, marketData.currency, true)} description="Cash remaining after capital expenditure."/>
          <QualityCard label="Operating Margin" value={decimalPercent(marketData.quality.operatingMargin)} description="Pricing power and operating cost discipline."/>
          <QualityCard label="PEG Ratio" value={ratio(marketData.quality.pegRatio, '')} description="P/E adjusted for expected earnings growth."/>
        </div>
      </section>
    </>}

    {newsError && <div className="sync-status error">{newsError}</div>}
    {newsSentiment ? <NewsSentimentFeed data={newsSentiment}/> : !newsError && <section className="panel"><div className="market-data-loading"><span className="spinner"/>Loading ticker news sentiment…</div></section>}

    <section className="panel stock-strategy-panel">
      <div className="panel-heading"><div><h2>Strategy Screen Results</h2><p>Mechanical matches based on the latest Yahoo Finance scan</p></div><div className="stock-strategy-actions">{strategyLoading && <span><i className="spinner"/>Updating this stock…</span>}<Link to="/strategy-screens">Explore all screens</Link></div></div>
      {strategyError && <div className="inline-error">{strategyError}</div>}
      {strategyScreens.length > 0 && <div className="stock-strategy-grid">{strategyScreens.map((screen) => <article key={screen._id}><span className={`strategy-status ${screen.status.toLowerCase()}`}>{screen.status === 'PASS' ? 'Match' : screen.status === 'NEAR' ? 'Near match' : screen.status === 'FAIL' ? 'No match' : 'Insufficient data'}</span><strong>{strategyNames[screen.strategy]}</strong><small>{screen.score}/100 score · {screen.dataCompleteness}% data coverage</small></article>)}</div>}
      {strategyLoading && strategyScreens.length === 0 && <div className="market-data-loading"><span className="spinner"/>Running all six strategy screens for {symbol}…</div>}
      {!strategyLoading && !strategyError && strategyScreens.length === 0 && <div className="advanced-placeholder"><p>No strategy data was returned for this stock.</p></div>}
    </section>

    <section className="panel stock-quant-panel">
      <div className="panel-heading"><div><h2>AI &amp; Quant Signals</h2><p>Five technical, fundamental, flow, and machine-learning engines</p></div><div className="stock-strategy-actions">{quantLoading && <span><i className="spinner"/>Calculating signals…</span>}<Link to="/ai-signals">Explore AI signals</Link></div></div>
      {quantError && <div className="inline-error">{quantError}</div>}
      {quantLoading && !quantResult && <div className="market-data-loading"><span className="spinner"/>Loading four years of daily data and calculating five engines…</div>}
      {quantResult && <>
        <div className="stock-meta-signal"><span><BrainCircuit size={22}/></span><div><small>AI Consensus · {quantResult.meta.regime} regime</small><strong className={`quant-${quantResult.meta.signal.toLowerCase()}`}>{quantSignalLabels[quantResult.meta.signal]}</strong><p>{quantResult.meta.score > 0 ? '+' : ''}{quantResult.meta.score.toFixed(2)} score · {quantResult.meta.confidence}% confidence · {quantResult.candleCount} daily candles</p></div></div>
        <div className="stock-quant-grid">{quantResult.engines.map((engine) => <article key={engine.key}><span className={`quant-signal ${engine.signal.toLowerCase()}`}>{quantSignalLabels[engine.signal]}</span><strong>{engine.name}</strong><small>{engine.score > 0 ? '+' : ''}{engine.score.toFixed(2)} score · {engine.confidence}% confidence</small><div>{engine.metrics.slice(0, 2).map((item) => <p key={item.key}><span>{item.label}</span><b>{item.displayValue}</b></p>)}</div></article>)}</div>
      </>}
    </section>

    <section className="panel advanced-panel">
      <div className="panel-heading"><div><h2>Advanced &amp; Situational Metrics</h2><p>Fetched only when requested to keep normal stock and watchlist loading light</p></div>{!advanced && <button className="secondary-button" onClick={loadAdvanced} disabled={advancedLoading}><RefreshCw size={15} className={advancedLoading ? 'spin' : ''}/>{advancedLoading ? 'Loading…' : 'Load advanced metrics'}</button>}</div>
      {advancedError && <div className="inline-error">{advancedError}</div>}
      {advanced && <div className="quality-grid advanced-grid">
        <QualityCard label="EV / EBITDA" value={ratio(advanced.enterpriseToEbitda)} description="Debt-aware valuation for cross-company comparisons."/>
        <QualityCard label="Beta" value={ratio(advanced.beta, '')} description="Sensitivity to broad market movements."/>
        <QualityCard label="Institutional Ownership" value={decimalPercent(advanced.institutionalOwnership)} description={`${advanced.institutionCount ?? 0} reported institutional holders.`}/>
        <QualityCard label="Dividend Yield" value={decimalPercent(advanced.dividendYield)} description="Income return relative to the current share price."/>
        <QualityCard label="Payout Ratio" value={decimalPercent(advanced.payoutRatio)} description="Share of earnings distributed as dividends."/>
        <QualityCard label={`Insider Activity${advanced.insiderActivity ? ` (${advanced.insiderActivity.period})` : ''}`} value={advanced.insiderActivity ? `${advanced.insiderActivity.netShares > 0 ? '+' : ''}${compactNumber(advanced.insiderActivity.netShares)} shares` : dash} description={advanced.insiderActivity ? `${advanced.insiderActivity.buyCount} reported buys and ${advanced.insiderActivity.sellCount} reported sells; interpret scheduled sales with care.` : 'No insider activity data is available.'}/>
      </div>}
      {!advanced && !advancedLoading && !advancedError && <div className="advanced-placeholder"><Gauge size={24}/><p>EV/EBITDA, beta, ownership, insider activity, dividend yield, and payout ratio are not fetched until you ask.</p></div>}
    </section>

    <div className="section-label"><Activity size={16}/><div><strong>MarketLens Recommendation Analysis</strong><small>The date range below applies to broker recommendations.</small></div></div>
    <DateRangeFilter value={dateRange} onChange={setDateRange}/>
    <div className="detail-stats"><div><small>Consensus</small>{a ? <RecommendationBadge value={a.consensus}/> : dash}</div><div><small>Unique Brokers</small><strong><Users size={18}/>{a?.uniqueBrokerCount || 0}</strong></div><div><small>BUY %</small><strong className="buy-text">{a?.buyPercentage || 0}%</strong></div><div><small>HOLD %</small><strong>{a?.holdPercentage || 0}%</strong></div><div><small>SELL %</small><strong className="sell-text">{a?.sellPercentage || 0}%</strong></div><div><small>Median Target</small><strong><Target size={18}/>{formatCurrency(a?.medianTarget)}</strong></div></div>
    <div className="detail-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Rating Distribution</h2><p>{a?.totalRecommendations || 0} broker recommendations</p></div></div><div className="chart-row"><ResponsiveContainer width="55%" height={220}><PieChart><Pie data={chart} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>{chart.map((entry) => <Cell key={entry.name} fill={entry.color}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer><div className="chart-legend">{chart.map((item) => <div key={item.name}><span style={{ background: item.color }}/><strong>{item.name}</strong><em>{item.value}</em></div>)}</div></div></section><section className="panel target-panel"><div className="panel-heading"><div><h2>MarketLens Target Snapshot</h2><p>Based on published broker targets</p></div></div><div className="target-value"><small>Median price target</small><strong>{formatCurrency(a?.medianTarget)}</strong><p>Average: {formatCurrency(a?.averageTarget)}</p></div></section></div>
    <section className="panel"><div className="panel-heading"><div><h2>Broker Recommendations</h2><p>{recommendations.length} calls from {a?.uniqueBrokerCount || 0} brokers across {publisherCount} publishers</p></div></div><RecommendationsTable recommendations={recommendationsExpanded ? recommendations : recommendations.slice(0, 5)} showPrevious/>{recommendations.length > 5 && <button type="button" className="expand-button" onClick={() => setRecommendationsExpanded((value) => !value)}>{recommendationsExpanded ? <><ChevronUp size={14}/>Show less</> : <><ChevronDown size={14}/>Show more ({recommendations.length - 5} more)</>}</button>}</section>
    <div className="market-data-disclaimer"><WalletCards size={14}/>Yahoo Finance metrics are third-party data supplied through an unofficial API and may be delayed or unavailable. Verify material figures before investing.</div>
  </>;
}
