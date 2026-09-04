import { ArrowDownRight, ArrowUpRight, ExternalLink, Newspaper, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MarketNewsHighlights as MarketNewsHighlightsData, NewsStory } from '../types';

const publishedTime = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
function NewsColumn({ tone, items }: { tone: 'bullish' | 'bearish'; items: NewsStory[] }) {
  const positive = tone === 'bullish';
  return <div className={`news-tone-column ${tone}`}>
    <div className="news-tone-heading">
      <span>{positive ? <ArrowUpRight size={17}/> : <ArrowDownRight size={17}/>}</span>
      <div><strong>{positive ? 'Good news' : 'Bad news'}</strong><small>{items.length} distinct stor{items.length === 1 ? 'y' : 'ies'}</small></div>
    </div>
    {items.length ? <>
      <div className="market-news-list">{items.map((item) => <article key={item._id}>
        <div className="market-news-story-top"><div className="story-stock-chips">{item.mentionedStocks.length ? item.mentionedStocks.map((stock) => <Link key={stock._id} to={`/stocks/${stock.symbol}`}>{stock.symbol}</Link>) : <span>Market-wide</span>}</div><em className={`sentiment-badge ${tone}`}>{positive ? 'Positive' : 'Negative'}</em></div>
        <a className="market-news-title" href={item.sources[0]?.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={12}/></a>
        {item.summary !== item.title && <p>{item.summary}</p>}
        <div className="story-source-row"><span>{item.articleCount > 1 ? `${item.articleCount} reports:` : 'Source:'}</span>{item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.publisher?.name || 'Financial news'}</a>)}</div>
        <small>{publishedTime(item.publishedAt)}</small>
      </article>)}</div>
    </> : <div className="market-news-empty">No {positive ? 'positive' : 'negative'} market news was found in this window.</div>}
  </div>;
}

export function MarketNewsHighlights({ data, onRefresh, refreshing }: { data: MarketNewsHighlightsData; onRefresh: () => void; refreshing: boolean }) {
  return <section className="panel market-news-panel">
    <div className="panel-heading"><div><h2>Market News Analysis</h2><p>General and stock-linked news sentiment over the last {data.windowHours} hours</p></div><div className="panel-actions"><button type="button" className="panel-refresh-button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={13} className={refreshing ? 'spin' : ''}/>{refreshing ? 'Updating…' : 'Refresh'}</button><Link className="small-view-button" to="/news">View all news</Link><Newspaper size={19}/></div></div>
    <div className="market-news-columns">
      <NewsColumn tone="bullish" items={data.bullish}/>
      <NewsColumn tone="bearish" items={data.bearish}/>
    </div>
  </section>;
}
