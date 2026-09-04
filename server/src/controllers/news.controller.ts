import type { Request, Response } from 'express';
import { NEWS_SENTIMENT_LABELS, type NewsSentimentLabel } from '../models/Article.js';
import { getNewsArchive } from '../services/news/newsSentiment.service.js';

export async function newsArchive(req: Request, res: Response) {
  const requestedSentiment = String(req.query.sentiment || '').toUpperCase();
  const sentiment = NEWS_SENTIMENT_LABELS.includes(requestedSentiment as NewsSentimentLabel)
    ? requestedSentiment as NewsSentimentLabel
    : undefined;
  const result = await getNewsArchive({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    sentiment,
    symbol: String(req.query.stock || '').trim() || undefined,
  });
  if (!result) return res.status(404).json({ message: 'Stock not found' });
  res.json(result);
}
