import { ChevronDown, ChevronUp, ExternalLink, Newspaper } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { StockNewsSentiment } from '../types';
import { EmptyState } from './Loading';

const score = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const COLLAPSED_COUNT = 6;

export function NewsSentimentFeed({ data }: { data: StockNewsSentiment }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data.items : data.items.slice(0, COLLAPSED_COUNT);
  const hasMore = data.items.length > COLLAPSED_COUNT;
  return <section className="panel news-sentiment-panel">
    <div className="panel-heading"><div><h2>{data.stock.symbol} News Only</h2><p>Verified headlines from RSS, Google News, and Yahoo Finance</p></div><div className="news-panel-actions"><Link className="small-view-button" to={`/news?stock=${encodeURIComponent(data.stock.symbol)}`}>View all</Link><div className="stock-mood-summary"><Newspaper size={16}/><strong>{data.summary.index}</strong><span className={`sentiment-badge ${data.summary.label.toLowerCase()}`}>{data.summary.label}</span></div></div></div>
    {data.items.length ? <>
      <div className="sentiment-feed">{visible.map((item) => <article key={item._id}>
        <div className="sentiment-feed-meta"><span className={`sentiment-badge ${item.sentimentLabel.toLowerCase()}`}>{item.sentimentLabel}</span><b>{score(item.sentimentScore)}</b><span>{item.articleCount > 1 ? `${item.articleCount} combined reports` : item.sources[0]?.publisher?.name || 'Financial news'}</span><time>{new Date(item.publishedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
        <a href={item.sources[0]?.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong><ExternalLink size={13}/></a>
        {item.summary !== item.title && <p>{item.summary}</p>}
        <div className="story-source-row">{item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.publisher?.name || 'Financial news'}</a>)}</div>
        {item.sentimentMethod === 'LEXICON_FALLBACK' && <small>Provisional headline-based sentiment.</small>}
      </article>)}</div>
      {hasMore && <button type="button" className="expand-button" onClick={() => setExpanded((value) => !value)}>{expanded ? <><ChevronUp size={14}/>Show less</> : <><ChevronDown size={14}/>Show more ({data.items.length - COLLAPSED_COUNT} more)</>}</button>}
    </> : <EmptyState>No verified news currently mentions this stock or ticker.</EmptyState>}
  </section>;
}
