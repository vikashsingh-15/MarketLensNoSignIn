import axios from 'axios';
import Parser from 'rss-parser';
import type { IStock } from '../../models/Stock.js';
import { textExplicitlyMentionsStock } from '../stock/normalization.service.js';

const parser = new Parser();
const CACHE_MS = 15 * 60 * 1000;
const FAILURE_CACHE_MS = 2 * 60 * 1000;

export interface GoogleStockNewsItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: Date;
}

const cache = new Map<string, { expiresAt: number; items: GoogleStockNewsItem[] }>();

function headlineAndPublisher(rawTitle: string, creator?: string) {
  const separator = rawTitle.lastIndexOf(' - ');
  if (separator <= 0) return { title: rawTitle.trim(), publisher: creator?.trim() || 'Google News' };
  const possiblePublisher = rawTitle.slice(separator + 3).trim();
  if (!possiblePublisher || possiblePublisher.length > 70) return { title: rawTitle.trim(), publisher: creator?.trim() || 'Google News' };
  return { title: rawTitle.slice(0, separator).trim(), publisher: creator?.trim() || possiblePublisher };
}

export async function getGoogleStockNews(stock: Pick<IStock, 'symbol' | 'companyName' | 'aliases'>, limit = 15) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 30));
  const cacheKey = `${stock.symbol}:${safeLimit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const company = stock.companyName.replace(/\b(?:limited|ltd)\.?\b/gi, '').replace(/\s+/g, ' ').trim();
  const query = encodeURIComponent(`("${company}" OR "${stock.symbol}") stock when:7d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const response = await axios.get<string>(url, {
      timeout: 10_000,
      responseType: 'text',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; MarketLens/1.0; +http://localhost)', accept: 'application/rss+xml, application/xml, text/xml' },
    });
    const feed = await parser.parseString(response.data);
    const items = feed.items.flatMap((item): GoogleStockNewsItem[] => {
      if (!item.title || !item.link) return [];
      const { title, publisher } = headlineAndPublisher(item.title, item.creator);
      if (!textExplicitlyMentionsStock(title, stock)) return [];
      const publishedAt = new Date(item.isoDate || item.pubDate || Date.now());
      if (!Number.isFinite(publishedAt.getTime())) return [];
      return [{ id: item.guid || item.link, title, url: item.link, publisher, publishedAt }];
    }).slice(0, safeLimit);
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, items });
    return items;
  } catch (error) {
    console.warn(`Google News RSS failed for ${stock.symbol}:`, axios.isAxiosError(error) ? error.message : error);
    cache.set(cacheKey, { expiresAt: Date.now() + FAILURE_CACHE_MS, items: [] });
    return [];
  }
}
