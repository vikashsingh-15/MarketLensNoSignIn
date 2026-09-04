import { Activity, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Analytics, MarketMood } from '../types';
import { RecommendationBadge } from './RecommendationBadge';

type MarketMoodGaugeProps = {
  mood: MarketMood;
  hotStocks: Analytics[];
  latestRecommendationDate: string | null;
  onRefreshMood: () => void;
  onRefreshHotStocks: () => void;
  refreshingMood: boolean;
  refreshingHotStocks: boolean;
};

const sourceDate = (value: string | null) => value
  ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'none yet';

export function MarketMoodGauge({ mood, hotStocks, latestRecommendationDate, onRefreshMood, onRefreshHotStocks, refreshingMood, refreshingHotStocks }: MarketMoodGaugeProps) {
  const index = Math.max(0, Math.min(100, mood.index));
  const angle = index * 1.8 - 180;
  return <section className="panel mood-panel">
    <div className="panel-heading"><div><h2>Market Mood Index</h2><p>Recency-weighted broker recommendations from the last {mood.windowHours || 24} hours</p></div><div className="panel-actions"><button type="button" className="panel-refresh-button" onClick={onRefreshMood} disabled={refreshingMood}><RefreshCw size={13} className={refreshingMood ? 'spin' : ''}/>{refreshingMood ? 'Updating…' : 'Refresh'}</button><Activity size={19}/></div></div>
    <div className="mood-content">
      <div className="mood-gauge" aria-label={`Market mood ${mood.label}, index ${index} out of 100`}>
        <div className="mood-arc"><span className="mood-needle" style={{ transform: `rotate(${angle}deg)` }}/><i/></div>
        <div className="mood-score"><strong>{index}</strong><span>/ 100</span></div>
        <span className={`sentiment-badge ${mood.label.toLowerCase()}`}>{mood.label}</span>
      </div>
      <div className="mood-breakdown">
        <Link className="mood-breakdown-link" to="/recommendations?recommendation=BUY"><span>Bullish</span><strong>{mood.counts.BULLISH}</strong></Link>
        <Link className="mood-breakdown-link" to="/recommendations?recommendation=HOLD"><span>Neutral</span><strong>{mood.counts.NEUTRAL}</strong></Link>
        <Link className="mood-breakdown-link" to="/recommendations?recommendation=SELL"><span>Bearish</span><strong>{mood.counts.BEARISH}</strong></Link>
        <p>Based on <strong>{mood.articleCount}</strong> distinct {mood.articleCount === 1 ? 'story' : 'stories'}{mood.rawArticleCount && mood.rawArticleCount !== mood.articleCount ? ` combined from ${mood.rawArticleCount} articles` : ''}. A score of 50 is neutral.</p>
      </div>
    </div>
    <div className="mood-hot-stocks">
      <div className="mood-hot-heading">
        <div><strong>Hot Stock Recommendations</strong><small>Most widely covered by unique brokers · Calls through {sourceDate(latestRecommendationDate)}</small></div>
        <div className="panel-actions"><button type="button" className="panel-refresh-button" onClick={onRefreshHotStocks} disabled={refreshingHotStocks}><RefreshCw size={13} className={refreshingHotStocks ? 'spin' : ''}/>{refreshingHotStocks ? 'Updating…' : 'Refresh'}</button><Link to="/hot-stocks">View all →</Link></div>
      </div>
      {hotStocks.length ? <div className="mood-hot-list">
        {hotStocks.slice(0, 10).map((item, index) => <Link to={`/stocks/${item.stock.symbol}`} key={item.stock.symbol}>
          <span className="mood-hot-rank">{index + 1}</span>
          <span className="mood-hot-company"><strong>{item.stock.symbol}</strong><small>{item.stock.companyName}</small></span>
          <span className="mood-hot-coverage"><strong>{item.uniqueBrokerCount}</strong><small>brokers</small></span>
          <span className="mood-hot-buy"><strong>{item.buyPercentage}%</strong><small>BUY</small></span>
          <RecommendationBadge value={item.consensus}/>
        </Link>)}
      </div> : <p className="mood-hot-empty">Hot stock coverage will appear after recommendations are ingested.</p>}
    </div>
  </section>;
}
