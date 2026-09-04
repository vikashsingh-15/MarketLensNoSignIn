import { Article, type NewsSentimentLabel } from '../../models/Article.js';
import { Stock } from '../../models/Stock.js';
import type { FilterQuery, Types } from 'mongoose';
import { textExplicitlyMentionsStock, type StockMentionIdentity } from '../stock/normalization.service.js';
import { getYahooStockNews, type YahooStockNewsItem } from '../market/yahooFinance.service.js';
import { getGoogleStockNews, type GoogleStockNewsItem } from './googleStockNews.service.js';

const bullishTerms: Array<[RegExp, number]> = [
  [/\b(record (?:profit|revenue|sales|high))\b/gi, 2.5], [/\b(beat estimates?|upgraded?|rate cut|tax cut|stimulus|strong growth)\b/gi, 2],
  [/\b(rally|surge[ds]?|soar(?:s|ed)?|gain(?:s|ed)?|growth|expansion|profit|bullish|outperform)\b/gi, 1],
  [/\b(order win|approval|acquisition|investment|dividend|buyback)\b/gi, 1.25],
];
const bearishTerms: Array<[RegExp, number]> = [
  [/\b(record (?:loss|low)|miss(?:ed|es)? estimates?)\b/gi, 2.5], [/\b(downgraded?|rate hike|tax hike|recession|default|fraud)\b/gi, 2],
  [/\b(crash|plunge[ds]?|slump|fall(?:s|en)?|decline[ds]?|loss|bearish|underperform|layoffs?)\b/gi, 1],
  [/\b(probe|penalty|lawsuit|warning|risk|inflation|slowdown)\b/gi, 1.25],
];

const countWeightedTerms = (text: string, terms: Array<[RegExp, number]>) => terms.reduce((sum, [pattern, weight]) => {
  pattern.lastIndex = 0;
  return sum + (text.match(pattern)?.length || 0) * weight;
}, 0);

export const sentimentLabelForScore = (score: number): NewsSentimentLabel => score > 0.15 ? 'BULLISH' : score < -0.15 ? 'BEARISH' : 'NEUTRAL';

export function fallbackNewsSentiment(text: string) {
  const plainText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const positive = countWeightedTerms(plainText, bullishTerms);
  const negative = countWeightedTerms(plainText, bearishTerms);
  const evidence = positive + negative;
  const score = evidence ? Math.max(-1, Math.min(1, (positive - negative) / Math.max(4, evidence))) : 0;
  const label = sentimentLabelForScore(score);
  return {
    sentimentLabel: label,
    sentimentScore: Number(score.toFixed(3)),
    sentimentConfidence: evidence ? Math.min(0.65, 0.3 + evidence * 0.04) : 0.2,
    sentimentReason: evidence ? `Provisional lexical signal from ${Math.round(positive)} positive and ${Math.round(negative)} negative weighted cues.` : 'No strong directional language was detected.',
    sentimentMethod: 'LEXICON_FALLBACK' as const,
  };
}

function aggregateMood(items: Array<{ sentimentScore?: number; sentimentConfidence?: number; publishedAt: Date }>) {
  const now = Date.now();
  let weightedScore = 0;
  let totalWeight = 0;
  for (const item of items) {
    const ageHours = Math.max(0, (now - new Date(item.publishedAt).getTime()) / 3_600_000);
    const recencyWeight = Math.exp(-ageHours / 24);
    const weight = recencyWeight * Math.max(0.2, item.sentimentConfidence || 0.5);
    weightedScore += (item.sentimentScore || 0) * weight;
    totalWeight += weight;
  }
  const score = totalWeight ? Math.max(-1, Math.min(1, weightedScore / totalWeight)) : 0;
  return { score: Number(score.toFixed(3)), index: Math.round((score + 1) * 50), label: sentimentLabelForScore(score) };
}

export async function getMarketMood(hours = 24) {
  const since = new Date(Date.now() - Math.max(1, Math.min(hours, 168)) * 3_600_000);
  const articles = await newsArticleQuery({ sentimentProcessed: true, publishedAt: { $gte: since }, sentimentScore: { $exists: true } }).limit(500).lean() as unknown as PopulatedNewsArticle[];
  const stories = clusterNewsArticles(articles);
  const mood = aggregateMood(stories);
  const counts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
  for (const story of stories) counts[story.sentimentLabel]++;
  return { ...mood, counts, articleCount: stories.length, rawArticleCount: articles.length, windowHours: hours, asOf: new Date().toISOString() };
}

type NewsStock = { _id: { toString(): string }; symbol: string; companyName: string; exchange: string; aliases?: string[] };
type NewsPublisher = { _id: { toString(): string }; name: string; website?: string };
type PopulatedNewsArticle = {
  _id: { toString(): string }; title: string; url: string; description?: string; publishedAt: Date;
  sentimentLabel: NewsSentimentLabel; sentimentScore?: number; sentimentConfidence?: number; sentimentReason?: string;
  sentimentMethod?: 'CEREBRAS' | 'LEXICON_FALLBACK' | 'DETERMINISTIC'; storyKey?: string; storySummary?: string;
  publisher?: NewsPublisher; mentionedStocks: NewsStock[];
};
type NewsArchiveStock = { _id: Types.ObjectId; symbol: string; companyName: string; exchange: string; aliases: string[] };
type NewsStorySource = { publisher?: { _id: string; name: string; website?: string }; url: string; title: string; publishedAt: Date };
export type NewsStoryRecord = {
  _id: string; storyKey: string; title: string; summary: string; publishedAt: Date; sentimentLabel: NewsSentimentLabel;
  sentimentScore: number; sentimentConfidence: number; sentimentMethod?: 'CEREBRAS' | 'LEXICON_FALLBACK' | 'DETERMINISTIC';
  mentionedStocks: Array<{ _id: string; symbol: string; companyName: string; exchange: string }>;
  sources: NewsStorySource[]; articleCount: number;
};
type WorkingStory = NewsStoryRecord & { articles: PopulatedNewsArticle[] };

const storyStopWords = new Set(['about', 'after', 'amid', 'and', 'are', 'for', 'from', 'heres', 'into', 'latest', 'live', 'market', 'markets', 'news', 'over', 'shares', 'stock', 'stocks', 'that', 'the', 'their', 'this', 'to', 'watch', 'week', 'why', 'with']);
const storyTokens = (value: string) => [...new Set(value.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').split(/\s+/).filter((token) => token.length >= 3 && !storyStopWords.has(token)))];
const similarity = (left: string[], right: string[]) => {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
};

export function createStoryKey(title: string) {
  return storyTokens(title).sort().slice(0, 14).join('-').slice(0, 120) || 'general-market-update';
}

function articlesMatch(left: PopulatedNewsArticle, right: PopulatedNewsArticle) {
  const hoursApart = Math.abs(new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime()) / 3_600_000;
  if (hoursApart > 96) return false;
  const leftKey = left.storyKey ? createStoryKey(left.storyKey) : createStoryKey(left.title);
  const rightKey = right.storyKey ? createStoryKey(right.storyKey) : createStoryKey(right.title);
  if (leftKey === rightKey && leftKey !== 'general-market-update') return true;
  const leftTokens = storyTokens(left.title);
  const rightTokens = storyTokens(right.title);
  const titleSimilarity = similarity(leftTokens, rightTokens);
  if (titleSimilarity >= 0.56) return true;
  const leftStocks = new Set(left.mentionedStocks.map((stock) => stock.symbol));
  const stocksOverlap = right.mentionedStocks.some((stock) => leftStocks.has(stock.symbol));
  return stocksOverlap && (titleSimilarity >= 0.3 || similarity(storyTokens(leftKey), storyTokens(rightKey)) >= 0.45);
}

function toStory(articles: PopulatedNewsArticle[]): NewsStoryRecord {
  const representative = [...articles].sort((a, b) => {
    const aQuality = (a.storySummary ? 2 : 0) + (a.sentimentConfidence || 0);
    const bQuality = (b.storySummary ? 2 : 0) + (b.sentimentConfidence || 0);
    return bQuality - aQuality || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  })[0];
  const stockMap = new Map<string, NewsStoryRecord['mentionedStocks'][number]>();
  const sourceMap = new Map<string, NewsStorySource>();
  let weightedScore = 0; let totalWeight = 0;
  for (const article of articles) {
    for (const stock of article.mentionedStocks) stockMap.set(stock.symbol, { ...stock, _id: stock._id.toString() });
    const sourceKey = article.publisher?._id.toString() || article.url;
    if (!sourceMap.has(sourceKey)) sourceMap.set(sourceKey, { publisher: article.publisher ? { ...article.publisher, _id: article.publisher._id.toString() } : undefined, url: article.url, title: article.title, publishedAt: article.publishedAt });
    const weight = Math.max(0.2, article.sentimentConfidence || 0.5);
    weightedScore += (article.sentimentScore || 0) * weight; totalWeight += weight;
  }
  const score = totalWeight ? Math.max(-1, Math.min(1, weightedScore / totalWeight)) : 0;
  return {
    _id: representative._id.toString(), storyKey: representative.storyKey || createStoryKey(representative.title),
    title: representative.title,
    summary: representative.storySummary || (representative.sentimentMethod === 'LEXICON_FALLBACK' ? representative.description : representative.sentimentReason || representative.description) || representative.title,
    publishedAt: new Date(Math.max(...articles.map((article) => new Date(article.publishedAt).getTime()))),
    sentimentLabel: sentimentLabelForScore(score), sentimentScore: Number(score.toFixed(3)),
    sentimentConfidence: Math.max(...articles.map((article) => article.sentimentConfidence || 0)), sentimentMethod: representative.sentimentMethod,
    mentionedStocks: [...stockMap.values()], sources: [...sourceMap.values()].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()), articleCount: articles.length,
  };
}

export function clusterNewsArticles(articles: PopulatedNewsArticle[]) {
  const groups: WorkingStory[] = [];
  for (const article of [...articles].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())) {
    const existing = groups.find((group) => group.articles.some((candidate) => articlesMatch(article, candidate)));
    if (existing) {
      existing.articles.push(article);
      Object.assign(existing, toStory(existing.articles));
    } else groups.push({ ...toStory([article]), articles: [article] });
  }
  return groups.map(({ articles: _articles, ...story }) => story);
}

const newsArticleQuery = (filter: FilterQuery<InstanceType<typeof Article>>) => Article.find(filter)
  .sort({ publishedAt: -1, _id: -1 })
  .select('title url description publishedAt sentimentLabel sentimentScore sentimentConfidence sentimentReason sentimentMethod storyKey storySummary mentionedStocks publisher analyzedAt')
  .populate('publisher', 'name website')
  .populate({ path: 'mentionedStocks', select: 'symbol companyName exchange aliases', match: { active: { $ne: false } } });

// The headline is the stock-page trust boundary. Scraped bodies and publisher snippets can
// contain unrelated ticker widgets or "related stories", as seen on ET Markets pages.
const stockArticleText = (article: PopulatedNewsArticle) => article.title;

function externalItemAsArticle(item: YahooStockNewsItem | GoogleStockNewsItem, stock: NewsArchiveStock, source: 'yahoo' | 'google'): PopulatedNewsArticle {
  const sentiment = fallbackNewsSentiment(item.title);
  const publisherId = `${source}-${item.publisher.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    _id: { toString: () => `${source}-${item.id}` },
    title: item.title,
    url: item.url,
    description: item.title,
    publishedAt: item.publishedAt,
    ...sentiment,
    sentimentReason: sentiment.sentimentReason,
    storyKey: createStoryKey(item.title),
    storySummary: item.title,
    publisher: { _id: { toString: () => publisherId }, name: item.publisher },
    mentionedStocks: [{ _id: { toString: () => stock._id.toString() }, symbol: stock.symbol, companyName: stock.companyName, exchange: stock.exchange, aliases: stock.aliases }],
  };
}

async function getVerifiedStockStories(stock: NewsArchiveStock) {
  const [storedArticles, yahooItems, googleItems] = await Promise.all([
    newsArticleQuery({ sentimentProcessed: true, mentionedStocks: stock._id }).limit(500).lean() as unknown as Promise<PopulatedNewsArticle[]>,
    getYahooStockNews(stock, 15),
    getGoogleStockNews(stock, 15),
  ]);
  const verifiedStoredArticles = storedArticles.filter((article) => textExplicitlyMentionsStock(stockArticleText(article), stock as StockMentionIdentity));
  return clusterNewsArticles([
    ...verifiedStoredArticles,
    ...yahooItems.map((item) => externalItemAsArticle(item, stock, 'yahoo')),
    ...googleItems.map((item) => externalItemAsArticle(item, stock, 'google')),
  ]);
}

export async function getMarketNewsHighlights(hours = 72, perTone = 5) {
  const safeHours = Math.max(1, Math.min(hours, 168));
  const safeLimit = Math.max(1, Math.min(perTone, 10));
  const since = new Date(Date.now() - safeHours * 3_600_000);
  const articles = await newsArticleQuery({ sentimentProcessed: true, publishedAt: { $gte: since }, sentimentScore: { $exists: true } }).limit(300).lean() as unknown as PopulatedNewsArticle[];
  const stories = clusterNewsArticles(articles);
  return { bullish: stories.filter((story) => story.sentimentLabel === 'BULLISH').slice(0, safeLimit), bearish: stories.filter((story) => story.sentimentLabel === 'BEARISH').slice(0, safeLimit), windowHours: safeHours, asOf: new Date().toISOString() };
}

export async function getNewsArchive(options: { page?: number; limit?: number; sentiment?: NewsSentimentLabel; symbol?: string }) {
  const page = Math.max(1, Math.floor(options.page || 1));
  const limit = Math.max(1, Math.min(Math.floor(options.limit || 20), 50));
  const filter: FilterQuery<InstanceType<typeof Article>> = { sentimentProcessed: true };
  let stock: NewsArchiveStock | null = null;
  if (options.symbol) {
    const normalized = options.symbol.trim().toUpperCase();
    stock = await Stock.findOne({ active: { $ne: false }, $or: [{ symbol: normalized }, { aliases: normalized }] }).select('_id symbol companyName exchange aliases').lean() as unknown as NewsArchiveStock | null;
    if (!stock) return null;
  }
  const allStories = stock ? await getVerifiedStockStories(stock) : clusterNewsArticles(await newsArticleQuery(filter).lean() as unknown as PopulatedNewsArticle[]);
  const counts = { ALL: allStories.length, BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
  for (const story of allStories) counts[story.sentimentLabel]++;
  const filteredStories = options.sentiment ? allStories.filter((story) => story.sentimentLabel === options.sentiment) : allStories;
  const total = filteredStories.length;
  return { stock: stock ? { _id: stock._id, symbol: stock.symbol, companyName: stock.companyName, exchange: stock.exchange } : null, items: filteredStories.slice((page - 1) * limit, page * limit), counts, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getStockNewsSentiment(symbol: string, limit = 30) {
  const normalized = symbol.trim().toUpperCase();
  const stock = await Stock.findOne({ active: { $ne: false }, $or: [{ symbol: normalized }, { aliases: normalized }] }).select('_id symbol companyName exchange aliases').lean() as unknown as NewsArchiveStock | null;
  if (!stock) return null;
  const stories = await getVerifiedStockStories(stock);
  const mood = aggregateMood(stories);
  const counts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
  for (const story of stories) counts[story.sentimentLabel]++;
  return { stock, summary: { ...mood, counts, articleCount: stories.length }, items: stories.slice(0, Math.max(1, Math.min(limit, 100))) };
}
