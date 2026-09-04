import { ExternalLink, Newspaper } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, Loading } from '../components/Loading';
import { api, getApiErrorMessage } from '../services/api';
import type { NewsArchive, NewsSentimentLabel } from '../types';

type NewsFilter = NewsSentimentLabel | 'ALL';
const filters: Array<{ value: NewsFilter; label: string }> = [
  { value: 'ALL', label: 'All news' },
  { value: 'BULLISH', label: 'Good' },
  { value: 'NEUTRAL', label: 'Neutral' },
  { value: 'BEARISH', label: 'Bad' },
];
const toneLabel: Record<NewsSentimentLabel, string> = { BULLISH: 'Good', NEUTRAL: 'Neutral', BEARISH: 'Bad' };

export function NewsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFilter = searchParams.get('sentiment')?.toUpperCase();
  const filter: NewsFilter = requestedFilter === 'BULLISH' || requestedFilter === 'BEARISH' || requestedFilter === 'NEUTRAL' ? requestedFilter : 'ALL';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const stock = searchParams.get('stock')?.trim().toUpperCase() || '';
  const [data, setData] = useState<NewsArchive | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api.get<NewsArchive>('/news', { params: { page, limit: 20, ...(filter !== 'ALL' ? { sentiment: filter } : {}), ...(stock ? { stock } : {}) } })
      .then(({ data: response }) => setData(response))
      .catch((requestError) => setError(getApiErrorMessage(requestError, 'News could not be loaded.')));
  }, [filter, page, stock]);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  };

  if (!data && !error) return <Loading/>;
  return <>
    <div className="page-heading news-page-heading"><div><p className="eyebrow">Live source archive</p><h1>{stock ? `${stock} News` : 'Market News'}</h1><p>{stock ? `All analyzed articles that explicitly mention ${stock}.` : 'All analyzed RSS and web-source articles, marked by likely market impact.'}</p></div><span className="news-archive-icon"><Newspaper size={21}/></span></div>
    {error && <div className="sync-status error">{error}</div>}
    {data && <>
      <div className="news-archive-toolbar">
        <div className="news-filter-tabs">{filters.map((item) => <button key={item.value} className={`${item.value.toLowerCase()} ${filter === item.value ? 'active' : ''}`} onClick={() => updateParams({ sentiment: item.value === 'ALL' ? null : item.value, page: null })}>{item.label}<span>{data.counts[item.value]}</span></button>)}</div>
        {data.stock && <div className="active-stock-filter"><span>{data.stock.symbol}</span><small>{data.stock.companyName}</small><button onClick={() => updateParams({ stock: null, page: null })}>Show all market news</button></div>}
      </div>
      {data.items.length ? <div className="news-archive-list">{data.items.map((item) => <article key={item._id} className={`news-archive-card ${item.sentimentLabel.toLowerCase()}`}>
        <div className="news-archive-card-top"><span className={`sentiment-badge ${item.sentimentLabel.toLowerCase()}`}>{toneLabel[item.sentimentLabel]}</span><span>{item.articleCount > 1 ? `${item.articleCount} combined reports` : item.sources[0]?.publisher?.name || 'Financial news'}</span><time>{new Date(item.publishedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
        <a href={item.sources[0]?.url} target="_blank" rel="noreferrer"><h2>{item.title}</h2><ExternalLink size={14}/></a>
        {item.summary !== item.title && <p>{item.summary}</p>}
        <div className="story-source-row"><span>Sources:</span>{item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.publisher?.name || 'Financial news'}</a>)}</div>
        <div className="news-archive-card-bottom"><div>{item.mentionedStocks.length ? item.mentionedStocks.map((mentioned) => <Link key={mentioned._id} to={`/stocks/${mentioned.symbol}`}>{mentioned.symbol}</Link>) : <span>Market-wide news</span>}</div>{item.sentimentMethod === 'LEXICON_FALLBACK' && <small>Provisional analysis</small>}</div>
      </article>)}</div> : <EmptyState>{`No ${filter === 'ALL' ? '' : `${toneLabel[filter as NewsSentimentLabel].toLowerCase()} `}news matches this filter.`}</EmptyState>}
      <div className="news-pagination"><button disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>Previous</button><span>Page {data.pagination.page} of {data.pagination.pages} / {data.pagination.total} distinct stories</span><button disabled={page >= data.pagination.pages} onClick={() => updateParams({ page: String(page + 1) })}>Next</button></div>
    </>}
  </>;
}
