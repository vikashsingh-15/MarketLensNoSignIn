import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { extract } from '@extractus/article-extractor';
import type { Types } from 'mongoose';

// Article Extractor selects the main readable content without publisher-specific body selectors.
import { Publisher } from '../../models/Publisher.js';
import { Article } from '../../models/Article.js';
import { cerebrasService } from '../ai/cerebras.service.js';
import { resolveMentionedStocks, resolveStock } from '../stock/normalization.service.js';
import { resolveBroker } from '../broker/normalization.service.js';
import { saveRecommendation } from '../recommendation/recommendation.service.js';
import { createStoryKey, fallbackNewsSentiment } from '../news/newsSentiment.service.js';

const parser = new Parser();
const RSS_ITEM_CONCURRENCY = 4;
const MAX_AI_ANALYSES_PER_RUN = 100;
const FALLBACK_RETRY_MS = 60 * 60 * 1000;
let activeNewsScan: Promise<MarketNewsSummary> | null = null;
let activeRecommendationScan: Promise<MarketNewsSummary> | null = null;

type ProcessingOutcome = 'recommendation-created' | 'recommendation-duplicate' | 'normalization-missed' | 'not-a-recommendation' | 'sentiment-fallback' | 'sentiment-provisional';
export type MarketNewsSummary = {
  publishers: number; feedsAttempted: number; feedsCompleted: number; feedItems: number; webItems: number;
  articlesAdded: number; articlesRetried: number; sentimentAnalyzed: number; sentimentFallbacks: number;
  stocksMentioned: number; recommendationsCreated: number; duplicates: number; normalizationMisses: number; errors: number;
};

export type MarketScanKind = 'news' | 'recommendations';
export type MarketScanStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  result: MarketNewsSummary | null;
  error: string | null;
};

const initialScanStatus = (): MarketScanStatus => ({ state: 'idle', startedAt: null, completedAt: null, result: null, error: null });
const scanStatuses: Record<MarketScanKind, MarketScanStatus> = {
  news: initialScanStatus(),
  recommendations: initialScanStatus(),
};

const emptySummary = (publishers: number): MarketNewsSummary => ({
  publishers, feedsAttempted: 0, feedsCompleted: 0, feedItems: 0, webItems: 0,
  articlesAdded: 0, articlesRetried: 0, sentimentAnalyzed: 0, sentimentFallbacks: 0,
  stocksMentioned: 0, recommendationsCreated: 0, duplicates: 0, normalizationMisses: 0, errors: 0,
});

async function processInBatches<T>(items: T[], batchSize: number, processItem: (item: T) => Promise<void>) {
  for (let offset = 0; offset < items.length; offset += batchSize) {
    await Promise.all(items.slice(offset, offset + batchSize).map(processItem));
  }
}

const mergeSummaries = (left: MarketNewsSummary, right: MarketNewsSummary): MarketNewsSummary => ({
  publishers: Math.max(left.publishers, right.publishers),
  feedsAttempted: left.feedsAttempted + right.feedsAttempted,
  feedsCompleted: left.feedsCompleted + right.feedsCompleted,
  feedItems: left.feedItems + right.feedItems,
  webItems: left.webItems + right.webItems,
  articlesAdded: left.articlesAdded + right.articlesAdded,
  articlesRetried: left.articlesRetried + right.articlesRetried,
  sentimentAnalyzed: left.sentimentAnalyzed + right.sentimentAnalyzed,
  sentimentFallbacks: left.sentimentFallbacks + right.sentimentFallbacks,
  stocksMentioned: left.stocksMentioned + right.stocksMentioned,
  recommendationsCreated: left.recommendationsCreated + right.recommendationsCreated,
  duplicates: left.duplicates + right.duplicates,
  normalizationMisses: left.normalizationMisses + right.normalizationMisses,
  errors: left.errors + right.errors,
});

function trackedScan(kind: MarketScanKind, runner: () => Promise<MarketNewsSummary>) {
  const active = kind === 'news' ? activeNewsScan : activeRecommendationScan;
  if (active) return active;

  scanStatuses[kind] = { state: 'running', startedAt: new Date().toISOString(), completedAt: null, result: null, error: null };
  const task = runner()
    .then((result) => {
      scanStatuses[kind] = { ...scanStatuses[kind], state: 'succeeded', completedAt: new Date().toISOString(), result, error: null };
      return result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown refresh error';
      scanStatuses[kind] = { ...scanStatuses[kind], state: 'failed', completedAt: new Date().toISOString(), result: null, error: message };
      throw error;
    })
    .finally(() => {
      if (kind === 'news') activeNewsScan = null;
      else activeRecommendationScan = null;
    });

  if (kind === 'news') activeNewsScan = task;
  else activeRecommendationScan = task;
  return task;
}

export function getMarketScanStatuses() {
  return { news: { ...scanStatuses.news }, recommendations: { ...scanStatuses.recommendations } };
}

export function startMarketScan(kind: MarketScanKind) {
  const alreadyRunning = Boolean(kind === 'news' ? activeNewsScan : activeRecommendationScan);
  const task = kind === 'news' ? fetchNewsUpdates() : fetchRecommendationUpdates();
  void task.catch(() => undefined);
  return { started: !alreadyRunning, status: { ...scanStatuses[kind] } };
}

async function markStructuredRecommendationNews(article: InstanceType<typeof Article>, stockId: Types.ObjectId, recommendation: 'BUY' | 'HOLD' | 'SELL', targetPrice: number, brokerName: string) {
  const sentimentLabel = recommendation === 'BUY' ? 'BULLISH' : recommendation === 'SELL' ? 'BEARISH' : 'NEUTRAL';
  const sentimentScore = recommendation === 'BUY' ? 0.65 : recommendation === 'SELL' ? -0.65 : 0;
  Object.assign(article, {
    sentimentProcessed: true,
    sentimentLabel,
    sentimentScore,
    sentimentConfidence: 0.95,
    sentimentReason: `${brokerName} published a ${recommendation} rating with a target price of ₹${targetPrice.toLocaleString('en-IN')}.`,
    sentimentMethod: 'DETERMINISTIC',
    storyKey: createStoryKey(article.title),
    storySummary: `${brokerName} published a ${recommendation} rating with a target price of ₹${targetPrice.toLocaleString('en-IN')}.`,
    mentionedStocks: [stockId],
    analyzedAt: new Date(),
  });
  await article.save();
}

function requestErrorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : 'Unknown error';
  const status = error.response?.status;
  return status ? `HTTP ${status} ${error.response?.statusText || ''}`.trim() : `${error.code || 'request failed'}: ${error.message}`;
}

async function fetchArticleText(url: string) {
  try {
    const article = await extract(url, { contentLengthThreshold: 150 }, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; MarketLens/1.0; +http://localhost)', 'accept-language': 'en-IN,en;q=0.9' },
      signal: AbortSignal.timeout(12000),
    });
    if (!article?.content) return '';
    return cheerio.load(article.content).text().replace(/\s+/g, ' ').trim();
  } catch (error) { console.warn(`Article webpage could not be scraped: ${url}`); return ''; }
}

async function saveFallbackSentiment(article: InstanceType<typeof Article>, text: string, mentionText: string) {
  const fallback = fallbackNewsSentiment(text);
  const mentionedStocks = await resolveMentionedStocks(mentionText);
  Object.assign(article, fallback, {
    sentimentProcessed: true,
    mentionedStocks: mentionedStocks.map((stock) => stock._id),
    analyzedAt: new Date(),
    storyKey: article.storyKey || createStoryKey(article.title),
    storySummary: article.description || article.title,
  });
  await article.save();
}

async function processArticle(article: InstanceType<typeof Article>, useAi = true): Promise<ProcessingOutcome> {
  const mentionText = `${article.title}\n${article.description || ''}`.trim();
  let text = mentionText;
  if (article.content) text += `\n${article.content}`;
  else {
    const content = await fetchArticleText(article.url);
    if (content) { article.content = content.slice(0, 14000); text += `\n${article.content}`; }
  }
  if (!useAi) {
    await saveFallbackSentiment(article, text, mentionText);
    return 'sentiment-provisional';
  }
  try {
    const extraction = await cerebrasService.analyzeArticle(text);
    const mentionedStocks = await resolveMentionedStocks(mentionText, extraction.mentionedTickers, extraction.mentionedCompanies);
    article.sentimentProcessed = true;
    article.sentimentLabel = extraction.sentimentLabel;
    article.sentimentScore = extraction.sentimentScore;
    article.sentimentConfidence = extraction.sentimentConfidence;
    article.sentimentReason = extraction.sentimentReason;
    article.sentimentMethod = 'CEREBRAS';
    article.storyKey = extraction.storyKey || createStoryKey(article.title);
    article.storySummary = extraction.storySummary || extraction.sentimentReason;
    article.mentionedStocks = mentionedStocks.map((stock) => stock._id);
    article.analyzedAt = new Date();
    if (extraction.containsRecommendation) {
      const [stock, broker] = await Promise.all([resolveStock(extraction.ticker, extraction.company), resolveBroker(extraction.broker)]);
      if (stock && broker && extraction.recommendation) {
        const result = await saveRecommendation({ stockId: stock._id, brokerId: broker._id, articleId: article._id, symbol: stock.symbol, brokerName: broker.name, recommendation: extraction.recommendation, targetPrice: extraction.targetPrice ?? undefined, previousTargetPrice: extraction.previousTargetPrice ?? undefined, date: article.publishedAt, confidence: extraction.confidence });
        article.processed = true; await article.save();
        return result.created ? 'recommendation-created' : 'recommendation-duplicate';
      }
      console.warn(`Recommendation could not be normalized: ${article.url} (stock=${extraction.ticker || extraction.company || 'unknown'}, broker=${extraction.broker || 'unknown'})`);
    }
    article.processed = true;
    await article.save();
    return extraction.containsRecommendation ? 'normalization-missed' : 'not-a-recommendation';
  } catch (error) {
    await saveFallbackSentiment(article, text, mentionText);
    console.warn(`AI article analysis failed; saved fallback sentiment for ${article.url}:`, error instanceof Error ? error.message : error);
    return 'sentiment-fallback';
  }
}

export async function fetchMarketNews() {
  const [news, recommendations] = await Promise.all([fetchNewsUpdates(), fetchRecommendationUpdates()]);
  const summary = mergeSummaries(news, recommendations);
  console.log('Combined market ingestion summary:', summary);
  return summary;
}

export function fetchNewsUpdates() {
  return trackedScan('news', runNewsScan);
}

export function fetchRecommendationUpdates() {
  return trackedScan('recommendations', runRecommendationScan);
}

async function runNewsScan(): Promise<MarketNewsSummary> {
  const publishers = await Publisher.find({ enabled: true });
  const summary = emptySummary(publishers.length);
  let aiAnalysesUsed = 0;
  if (!publishers.length) console.warn('No enabled RSS publishers found. Run npm run init:data first.');
  for (const publisher of publishers) {
    const feedUrls = [...new Set([publisher.rssUrl, ...(publisher.rssUrls || [])].filter((url): url is string => Boolean(url)))];
    for (const feedUrl of feedUrls) {
      summary.feedsAttempted++;
      try {
        const feed = await parser.parseURL(feedUrl);
        summary.feedsCompleted++;
        console.log(`RSS ${publisher.name}: received ${feed.items.length} items from ${feedUrl}`);
        for (let offset = 0; offset < feed.items.length; offset += RSS_ITEM_CONCURRENCY) {
          await Promise.all(feed.items.slice(offset, offset + RSS_ITEM_CONCURRENCY).map(async (item) => {
            const url = item.link || item.guid;
            if (!url || !item.title) return;
            summary.feedItems++;
            try {
              let article = await Article.findOne({ url });
              if (!article) {
                article = await Article.create({ publisher: publisher._id, title: item.title, url, description: item.contentSnippet || item.content || item.summary, publishedAt: new Date(item.isoDate || item.pubDate || Date.now()), processed: false });
                summary.articlesAdded++;
              } else if (article.processed && article.sentimentProcessed) {
                return;
              } else if (article.sentimentMethod === 'LEXICON_FALLBACK' && article.analyzedAt && Date.now() - article.analyzedAt.getTime() < FALLBACK_RETRY_MS) {
                return;
              } else {
                summary.articlesRetried++;
              }
              const useAi = aiAnalysesUsed < MAX_AI_ANALYSES_PER_RUN;
              if (useAi) aiAnalysesUsed++;
              const outcome = await processArticle(article, useAi);
              if (outcome === 'recommendation-created') summary.recommendationsCreated++;
              if (outcome === 'recommendation-duplicate') summary.duplicates++;
              if (outcome === 'normalization-missed') summary.normalizationMisses++;
              if (outcome === 'sentiment-fallback' || outcome === 'sentiment-provisional') summary.sentimentFallbacks++;
              else summary.sentimentAnalyzed++;
              if (outcome === 'sentiment-fallback') summary.errors++;
              summary.stocksMentioned += article.mentionedStocks.length;
            } catch (error) { summary.errors++; console.error(`RSS item failed: ${url}`, error); }
          }));
        }
      } catch (error) { summary.errors++; console.error(`RSS feed failed: ${publisher.name} (${feedUrl})`, error); }
    }
  }
  console.log('Market news ingestion summary:', summary);
  return summary;
}

async function runRecommendationScan(): Promise<MarketNewsSummary> {
  const publishers = await Publisher.find({ enabled: true, name: { $in: ['ET Markets', 'Moneycontrol', 'Trendlyne'] } });
  const summary = emptySummary(publishers.length);
  if (!publishers.length) console.warn('No enabled recommendation publishers found. Run npm run init:data first.');
  const etMarkets = publishers.find((publisher) => publisher.name === 'ET Markets');
  if (etMarkets) await scrapeEtMarketsRecommendations(etMarkets, summary);
  const moneycontrol = publishers.find((publisher) => publisher.name === 'Moneycontrol');
  if (moneycontrol) await scrapeMoneycontrolStockIdeas(moneycontrol, summary);
  const trendlyne = publishers.find((publisher) => publisher.name === 'Trendlyne');
  if (trendlyne) await scrapeTrendlyneRecommendations(trendlyne, summary);
  console.log('Recommendation ingestion summary:', summary);
  return summary;
}

async function scrapeMoneycontrolStockIdeas(publisher: InstanceType<typeof Publisher>, summary: {
  webItems: number; articlesAdded: number; articlesRetried: number; recommendationsCreated: number;
  duplicates: number; normalizationMisses: number; errors: number;
}) {
  const resolvedSymbols = new Set<string>();
  const listingUrls = publisher.webUrls.length
    ? publisher.webUrls
    : ['https://m.moneycontrol.com/markets/stock-advice/'];
  const discovered = new Map<string, string>();
  for (const listingUrl of listingUrls) {
    try {
      const { data } = await axios.get<string>(listingUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarketLens/1.0; +http://localhost)',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
      });
      const $ = cheerio.load(data);
      $('a[href]').each((_index, element) => {
        const title = $(element).text().replace(/\s+/g, ' ').trim();
        const href = $(element).attr('href');
        if (!href || !title || !/\b(buy|sell|hold|target|recommend)/i.test(title)) return;
        try {
          const url = new URL(href, listingUrl).toString().split('?')[0];
          if (url.includes('moneycontrol.com/') && url !== listingUrl) discovered.set(url, title);
        } catch { /* ignore malformed links */ }
      });
    } catch (error) {
      summary.errors++;
      console.warn(`Moneycontrol listing could not be scraped: ${listingUrl} (${requestErrorMessage(error)})`);
    }
  }

  console.log(`Moneycontrol web scraper: discovered ${discovered.size} recommendation links`);
  await processInBatches([...discovered].slice(0, 50), 6, async ([url, title]) => {
    summary.webItems++;
    try {
      let article = await Article.findOne({ url });
      if (!article) {
        article = await Article.create({ publisher: publisher._id, title, url, publishedAt: new Date(), processed: false });
        summary.articlesAdded++;
      }
      const titleRecommendation = parseMoneycontrolRecommendation(title);
      if (titleRecommendation) {
        const [stock, broker] = await Promise.all([resolveStock(null, titleRecommendation.company), resolveBroker(titleRecommendation.broker)]);
        if (stock && broker) {
          resolvedSymbols.add(stock.symbol);
          const result = await saveRecommendation({ stockId: stock._id, brokerId: broker._id, articleId: article._id, symbol: stock.symbol, brokerName: broker.name, recommendation: titleRecommendation.recommendation, targetPrice: titleRecommendation.targetPrice, date: article.publishedAt, confidence: 0.99 });
          article.processed = true;
          await markStructuredRecommendationNews(article, stock._id, titleRecommendation.recommendation, titleRecommendation.targetPrice, broker.name);
          if (result.created) summary.recommendationsCreated++; else summary.duplicates++;
          return;
        }
      }
      if (article.processed) return;
      summary.articlesRetried++;
      const outcome = await processArticle(article);
      if (outcome === 'recommendation-created') summary.recommendationsCreated++;
      if (outcome === 'recommendation-duplicate') summary.duplicates++;
      if (outcome === 'normalization-missed') summary.normalizationMisses++;
      if (outcome === 'sentiment-fallback') summary.errors++;
    } catch (error) { summary.errors++; console.error(`Moneycontrol recommendation failed: ${url}`, error); }
  });
  return [...resolvedSymbols];
}

function parseMoneycontrolRecommendation(title: string) {
  const match = title.match(/^\s*(Buy|Sell|Hold|Reduce|Accumulate|Add|Neutral|Outperform|Underperform|Overweight|Underweight)\s+(.+?)\s*[;:]\s*target(?:\s+of)?\s*(?:Rs\.?|INR|₹)\s*([\d,.]+)\s*:\s*(.+?)\s*$/i);
  if (!match) return null;
  const recommendation = normalizeBrokerRating(match[1]);
  if (!recommendation) return null;
  return {
    company: match[2].trim(),
    recommendation,
    targetPrice: Number(match[3].replace(/,/g, '')),
    broker: match[4].replace(/\s*[|–-].*$/, '').trim(),
  };
}

function normalizeBrokerRating(value: string): 'BUY' | 'HOLD' | 'SELL' | null {
  const rating = value.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(BUY|ACCUMULATE|ADD|OUTPERFORM|OVERWEIGHT)\b/.test(rating)) return 'BUY';
  if (/\b(HOLD|NEUTRAL|EQUAL WEIGHT|MARKET PERFORM)\b/.test(rating)) return 'HOLD';
  if (/\b(SELL|REDUCE|UNDERPERFORM|UNDERWEIGHT)\b/.test(rating)) return 'SELL';
  return null;
}

async function scrapeEtMarketsRecommendations(publisher: InstanceType<typeof Publisher>, summary: {
  webItems: number; articlesAdded: number; recommendationsCreated: number;
  duplicates: number; normalizationMisses: number; errors: number;
}) {
  const listingUrl = publisher.webUrls[0] || 'https://economictimes.indiatimes.com/markets/stock-recos/newrecos/all';
  try {
    const { data } = await axios.get<string>(listingUrl, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketLens/1.0; +http://localhost)',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
    });
    const $ = cheerio.load(data);
    const rows: Array<{ date: string; stock: string; broker: string; target: number; recommendation: 'BUY' | 'HOLD' | 'SELL'; url: string }> = [];

    $('[class*="StockReco_stockRecosPage"]').each((_index, card) => {
      const recommendation = normalizeBrokerRating($(card).find('[class*="StockReco_buySellTitle"]').first().text());
      const date = $(card).find('[class*="StockReco_callDateBox"] span').last().text().trim();
      const stockElement = $(card).find('[class*="StockReco_stocksTitle"] a').first();
      const stock = stockElement.attr('title') || stockElement.text().trim();
      const brokerElement = $(card).find('[class*="StockReco_brokerageBox"] a').first();
      const broker = brokerElement.attr('title') || brokerElement.text().trim();
      const targetItem = $(card).find('[class*="StockReco_targetBox"] li')
        .filter((_itemIndex, item) => $(item).find('span').first().text().trim() === 'Target')
        .first();
      const target = Number(targetItem.find('span').eq(1).text().replace(/[^\d.]/g, ''));
      const url = $(card).find('[class*="StockReco_reportCta"] a[href]').first().attr('href');
      if (date && stock && broker && target && recommendation && url) rows.push({ date, stock, broker, target, recommendation, url });
    });

    console.log(`ET Markets recommendations scraper: discovered ${rows.length} structured recommendations`);
    await processInBatches(rows.slice(0, 30), 6, async (row) => {
      summary.webItems++;
      try {
        const [stock, broker] = await Promise.all([resolveStock(null, row.stock), resolveBroker(row.broker)]);
        if (!stock || !broker) { summary.normalizationMisses++; return; }
        const parsedDate = new Date(row.date);
        const recommendationDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
        let article = await Article.findOne({ url: row.url });
        if (!article) {
          article = await Article.create({
            publisher: publisher._id,
            title: `${row.recommendation} ${row.stock}; target ₹${row.target}: ${row.broker}`,
            url: row.url,
            publishedAt: recommendationDate,
            processed: true,
          });
          summary.articlesAdded++;
        }
        const result = await saveRecommendation({
          stockId: stock._id,
          brokerId: broker._id,
          articleId: article._id,
          symbol: stock.symbol,
          brokerName: broker.name,
          recommendation: row.recommendation,
          targetPrice: row.target,
          date: recommendationDate,
          confidence: 1,
        });
        article.processed = true;
        await markStructuredRecommendationNews(article, stock._id, row.recommendation, row.target, broker.name);
        if (result.created) summary.recommendationsCreated++; else summary.duplicates++;
      } catch (error) {
        summary.errors++;
        console.error(`ET Markets recommendation failed: ${row.stock}`, error);
      }
    });
  } catch (error) {
    summary.errors++;
    console.error(`ET Markets recommendations page could not be scraped (${requestErrorMessage(error)})`);
  }
}

type StructuredRecommendation = {
  date: string;
  stock: string;
  broker: string;
  target: number;
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  url: string;
};

function parseTrendlyneRows(html: string, sourcePageUrl: string, fragment = false) {
  const $ = cheerio.load(fragment ? `<table>${html}</table>` : html);
  const rows: StructuredRecommendation[] = [];
  $('table tbody tr').each((_index, row) => {
    const cells = $(row).find('td');
    if (cells.length < 8) return;
    const offset = cells.eq(0).text().trim() ? 0 : 1;
    const date = cells.eq(offset).text().replace(/\s+/g, ' ').trim();
    const stock = (cells.eq(offset + 1).find('a').first().text() || cells.eq(offset + 1).text()).replace(/\s+/g, ' ').trim();
    const broker = (cells.eq(offset + 2).find('a').first().text() || cells.eq(offset + 2).text())
      .replace(/\b(?:Reco\s+)?Target\b/gi, '').replace(/\s+/g, ' ').trim();
    const target = Number(cells.eq(offset + 4).text().replace(/[^\d.]/g, ''));
    const recommendation = normalizeBrokerRating(cells.eq(offset + 7).text());
    if (!date || !stock || !broker || !target || !recommendation) return;
    const href = $(row).find('a[href*="/get-document/post/pdf/"]').first().attr('href') || $(row).find('a[href]').last().attr('href');
    const url = href ? new URL(href, sourcePageUrl).toString() : `${sourcePageUrl}#${encodeURIComponent(`${date}-${stock}-${broker}`)}`;
    rows.push({ date, stock, broker, target, recommendation, url });
  });
  return rows;
}

async function scrapeTrendlyneRecommendations(publisher: InstanceType<typeof Publisher>, summary: {
  webItems: number; articlesAdded: number; recommendationsCreated: number;
  duplicates: number; normalizationMisses: number; errors: number;
}) {
  const listingUrl = publisher.webUrls[0] || 'https://trendlyne.com/research-reports/all/';
  try {
    const response = await axios.get<string>(listingUrl, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketLens/1.0; +http://localhost)', 'Accept-Language': 'en-IN,en;q=0.9' } });
    const rows = [...new Map(parseTrendlyneRows(response.data, listingUrl).map((row) => [
      `${row.date}|${row.stock}|${row.broker}|${row.recommendation}|${row.target}`.toUpperCase(), row,
    ])).values()];

    console.log(`Trendlyne web scraper: discovered ${rows.length} current recommendations`);
    await processInBatches(rows, 6, async (row) => {
      summary.webItems++;
      try {
        const [stock, broker] = await Promise.all([resolveStock(null, row.stock), resolveBroker(row.broker)]);
        if (!stock || !broker) { summary.normalizationMisses++; return; }
        const recommendationDate = Number.isNaN(new Date(row.date).getTime()) ? new Date() : new Date(row.date);
        let article = await Article.findOne({ url: row.url });
        if (!article) {
          article = await Article.create({ publisher: publisher._id, title: `${row.recommendation} ${row.stock}; target ₹${row.target}: ${row.broker}`, url: row.url, publishedAt: recommendationDate, processed: true });
          summary.articlesAdded++;
        }
        const result = await saveRecommendation({ stockId: stock._id, brokerId: broker._id, articleId: article._id, symbol: stock.symbol, brokerName: broker.name, recommendation: row.recommendation, targetPrice: row.target, date: recommendationDate, confidence: 1 });
        article.processed = true;
        await markStructuredRecommendationNews(article, stock._id, row.recommendation, row.target, broker.name);
        if (result.created) summary.recommendationsCreated++; else summary.duplicates++;
      } catch (error) { summary.errors++; console.error(`Trendlyne recommendation failed: ${row.stock}`, error); }
    });
  } catch (error) { summary.errors++; console.error(`Trendlyne listing could not be scraped (${requestErrorMessage(error)})`); }
}
