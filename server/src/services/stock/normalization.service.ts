import type { Types } from 'mongoose';
import { Stock } from '../../models/Stock.js';

const normalize = (value: string) => value.toLowerCase().replace(/\b(limited|ltd)\b/g, '').replace(/[^a-z0-9]/g, '');
const normalizePhrase = (value: string) => value.toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(limited|ltd)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const CACHE_TTL_MS = 5 * 60 * 1000;

const ambiguousTickerWords = new Set(['BSE', 'GLOBAL', 'NSE', 'RETAIL']);
const genericSingleWordAliases = new Set([
  'bank', 'business', 'capital', 'energy', 'finance', 'financial', 'global', 'industries', 'industry', 'markets',
  'network', 'persistent', 'power', 'retail', 'services', 'steel', 'ventures',
]);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type StockCandidate = { _id: Types.ObjectId; symbol: string; companyName: string; aliases: string[] };
let stockCache: { expiresAt: number; records: StockCandidate[] } | null = null;

export type StockMentionIdentity = Pick<StockCandidate, 'symbol' | 'companyName' | 'aliases'>;

/**
 * A stock page uses this stricter check instead of trusting an inferred database link.
 * Symbols must be written as tickers, while company identities must be complete phrases
 * or distinctive brands. This prevents words such as "global" and "retail" from being
 * interpreted as GLOBAL or RETAIL shares in ordinary market reporting.
 */
export function textExplicitlyMentionsStock(text: string, stock: StockMentionIdentity) {
  if (!text.trim()) return false;
  const symbol = stock.symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const escapedSymbol = escapeRegExp(symbol);
  const exchangeQualified = new RegExp(`(?:NSE|BSE)\\s*[:\\-]\\s*${escapedSymbol}(?=$|[^A-Za-z0-9])`, 'i').test(text);
  const cashtag = new RegExp(`\\$${escapedSymbol}(?=$|[^A-Za-z0-9])`).test(text);
  const stockQualified = new RegExp(`(^|[^A-Za-z0-9])${escapedSymbol}\\s+(?:shares?|stocks?)(?=$|[^A-Za-z0-9])`, 'i').test(text);
  if (exchangeQualified || cashtag || stockQualified) return true;
  const uppercaseTicker = new RegExp(`(^|[^A-Za-z0-9])${escapedSymbol}(?=$|[^A-Za-z0-9])`).test(text);
  if (uppercaseTicker && !ambiguousTickerWords.has(symbol)) return true;

  const phraseText = ` ${normalizePhrase(text)} `;
  const identities = [stock.companyName, ...stock.aliases]
    .map(normalizePhrase)
    .filter(Boolean)
    .filter((identity, index, values) => values.indexOf(identity) === index)
    .filter((identity) => identity !== symbol.toLowerCase());
  return identities.some((identity) => {
    const words = identity.split(' ').filter(Boolean);
    if (words.length >= 2 && identity.replace(/\s/g, '').length >= 7) return phraseText.includes(` ${identity} `);
    const word = words[0];
    if (!word || word.length < 5 || genericSingleWordAliases.has(word)) return false;
    return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(word)}(?=$|[^A-Za-z0-9])`, 'i').test(text);
  });
}

export function invalidateStockNormalizationCache() { stockCache = null; }

async function getStockCandidates() {
  if (stockCache && stockCache.expiresAt > Date.now()) return stockCache.records;
  const records = await Stock.find({ active: { $ne: false } }).select('_id symbol companyName aliases').lean() as unknown as StockCandidate[];
  stockCache = { expiresAt: Date.now() + CACHE_TTL_MS, records };
  return records;
}

export async function resolveStock(ticker?: string | null, company?: string | null) {
  const candidates = [ticker, company].filter(Boolean).map((value) => normalize(value!));
  if (!candidates.length) return null;
  const stocks = await getStockCandidates();
  const rawTicker = ticker?.trim().toUpperCase();
  if (rawTicker) {
    const exactTickerMatch = stocks.find((stock) => [stock.symbol, ...stock.aliases].some((value) => value.trim().toUpperCase() === rawTicker));
    if (exactTickerMatch) return exactTickerMatch;
  }
  const normalizedCompany = company ? normalize(company) : '';
  if (normalizedCompany) {
    const exactCompanyMatch = stocks.find((stock) => normalize(stock.companyName) === normalizedCompany);
    if (exactCompanyMatch) return exactCompanyMatch;
  }
  const ranked = stocks.map((stock) => {
    const identities = [stock.symbol, stock.companyName, ...stock.aliases].map(normalize).filter(Boolean);
    const score = Math.max(0, ...candidates.flatMap((candidate) => identities.map((identity) => {
      if (candidate === identity) return 1;
      if (candidate.length < 5 || identity.length < 5 || (!candidate.includes(identity) && !identity.includes(candidate))) return 0;
      return Math.min(candidate.length, identity.length) / Math.max(candidate.length, identity.length);
    })));
    return { stock, score };
  }).filter((item) => item.score >= 0.5).sort((a, b) => b.score - a.score || b.stock.symbol.length - a.stock.symbol.length);
  return ranked[0]?.stock || null;
}

export async function resolveMentionedStocks(text: string, tickers: string[] = [], companies: string[] = []) {
  const stocks = await getStockCandidates();
  const bySymbol = new Map(stocks.map((stock) => [stock.symbol.toUpperCase(), stock]));
  const matches = new Map<string, StockCandidate>();
  for (const ticker of tickers) {
    const stock = bySymbol.get(ticker.trim().toUpperCase().replace(/\.(NS|BO)$/i, ''));
    if (stock && textExplicitlyMentionsStock(text, stock)) matches.set(String(stock._id), stock);
  }
  for (const company of companies) {
    const stock = await resolveStock(null, company);
    if (stock && textExplicitlyMentionsStock(text, stock)) matches.set(String(stock._id), stock);
  }

  const uppercaseTokens = text.match(/(?<![A-Za-z0-9])\$?([A-Z][A-Z0-9&-]{2,14})(?![A-Za-z0-9])/g) || [];
  for (const token of uppercaseTokens) {
    const stock = bySymbol.get(token.replace(/^\$/, ''));
    if (stock && textExplicitlyMentionsStock(text, stock)) matches.set(String(stock._id), stock);
  }

  for (const stock of stocks) {
    if (textExplicitlyMentionsStock(text, stock)) matches.set(String(stock._id), stock);
  }
  return [...matches.values()];
}
