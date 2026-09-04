import { Link } from 'react-router-dom';
import type { Analytics } from '../types';
import { RecommendationBadge } from './RecommendationBadge';
import { formatCurrency } from '../utils/format';
import { StockEventIndicator } from './StockEventIndicator';
export function HotStocksTable({ stocks, compact = false }: { stocks: Analytics[]; compact?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Stock</th><th>Company</th><th>Brokers</th><th>BUY</th><th>HOLD</th><th>SELL</th><th>Consensus</th>{!compact && <th>Median Target</th>}</tr></thead>
  <tbody>{stocks.map((item, index) => <tr key={item.stock.symbol}><td className="rank">{index + 1}</td><td><div className="stock-symbol-cell"><Link className="symbol-link" to={`/stocks/${item.stock.symbol}`}>{item.stock.symbol}</Link><StockEventIndicator stock={item.stock}/></div></td><td>{item.stock.companyName}</td><td>{item.uniqueBrokerCount}</td><td className="buy-text">{item.buyCount}</td><td>{item.holdCount}</td><td className="sell-text">{item.sellCount}</td><td><RecommendationBadge value={item.consensus}/></td>{!compact && <td>{formatCurrency(item.medianTarget)}</td>}</tr>)}</tbody></table></div>;
}
