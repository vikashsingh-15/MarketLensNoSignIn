import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterNewsArticles } from './newsSentiment.service.js';

const id = (value: string) => ({ toString: () => value });
const stock = (symbol: string) => ({ _id: id(symbol), symbol, companyName: symbol, exchange: 'NSE' });
const article = (identifier: string, publisher: string, stocks: string[], overrides: Record<string, unknown> = {}) => ({
  _id: id(identifier),
  title: 'FIIs raise stakes in 12 stocks for three straight quarters; shares surge up to 130%',
  url: `https://${publisher.toLowerCase().replace(/\s+/g, '')}.example/story`,
  publishedAt: new Date('2026-08-17T10:00:00Z'),
  sentimentLabel: 'BULLISH' as const,
  sentimentScore: 0.8,
  sentimentConfidence: 0.9,
  sentimentReason: 'Foreign investors increased holdings.',
  storyKey: 'fii-stake-increase-bse-500-stocks',
  storySummary: 'Foreign investors raised stakes across several BSE 500 companies.',
  publisher: { _id: id(publisher), name: publisher },
  mentionedStocks: stocks.map(stock),
  ...overrides,
});

test('combines the same story across stocks and publishers without repeated cards', () => {
  const stories = clusterNewsArticles([
    article('a1', 'ET Markets', ['KIRLOSENG', 'RRKABEL']),
    article('a2', 'Mint', ['AETHER', 'APARINDS']),
  ] as Parameters<typeof clusterNewsArticles>[0]);

  assert.equal(stories.length, 1);
  assert.equal(stories[0].articleCount, 2);
  assert.deepEqual(stories[0].mentionedStocks.map((item) => item.symbol), ['KIRLOSENG', 'RRKABEL', 'AETHER', 'APARINDS']);
  assert.deepEqual(stories[0].sources.map((item) => item.publisher?.name), ['ET Markets', 'Mint']);
});

test('keeps unrelated events as separate stories', () => {
  const stories = clusterNewsArticles([
    article('a1', 'ET Markets', ['BSE']),
    article('a2', 'Mint', ['INFY'], { title: 'Infosys wins a major digital transformation contract', storyKey: 'infosys-digital-contract-win' }),
  ] as Parameters<typeof clusterNewsArticles>[0]);

  assert.equal(stories.length, 2);
});
