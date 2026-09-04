import { Link } from 'react-router-dom';
import type { Recommendation } from '../types';
import { formatCurrency, formatDate } from '../utils/format';
import { RecommendationBadge } from './RecommendationBadge';
import { StockEventIndicator } from './StockEventIndicator';

function recommendationSources(item: Recommendation) {
  const articles = [...(item.articles || []), ...(item.article ? [item.article] : [])];
  return [...new Map(articles
    .filter((article) => article.publisher?.name)
    .map((article) => [article.publisher?._id || article.publisher?.name, article])).values()];
}

export function RecommendationsTable({ recommendations, showPrevious = false }: { recommendations: Recommendation[]; showPrevious?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Stock</th><th>Broker</th><th>Recommendation</th><th>Target</th>{showPrevious && <th>Previous Target</th>}<th>Date</th><th>Publisher</th></tr></thead><tbody>
  {recommendations.map((item) => {
    const sources = recommendationSources(item);
    return <tr key={item._id}><td><div className="stock-symbol-cell"><Link className="symbol-link" to={`/stocks/${item.stock.symbol}`}>{item.stock.symbol}</Link><StockEventIndicator stock={item.stock}/></div></td><td>{item.broker.name}</td><td><RecommendationBadge value={item.recommendation}/></td><td>{formatCurrency(item.targetPrice)}</td>{showPrevious && <td>{formatCurrency(item.previousTargetPrice)}</td>}<td>{formatDate(item.recommendationDate)}</td><td><div className="source-list">{sources.length ? sources.map((source) => source.url ? <a className="source-link" href={source.url} target="_blank" rel="noreferrer" key={source.publisher?._id || source.url}>{source.publisher?.name}</a> : <span key={source.publisher?._id || source._id}>{source.publisher?.name}</span>) : '—'}</div></td></tr>;
  })}
  </tbody></table></div>;
}
