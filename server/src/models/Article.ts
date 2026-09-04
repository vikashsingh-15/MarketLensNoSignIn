import { Schema, model, type Types } from 'mongoose';
export const NEWS_SENTIMENT_LABELS = ['BULLISH', 'BEARISH', 'NEUTRAL'] as const;
export type NewsSentimentLabel = typeof NEWS_SENTIMENT_LABELS[number];
export interface IArticle {
  publisher: Types.ObjectId; title: string; url: string; description?: string; content?: string; publishedAt: Date;
  processed: boolean; sentimentProcessed: boolean; sentimentLabel?: NewsSentimentLabel; sentimentScore?: number;
  sentimentConfidence?: number; sentimentReason?: string; sentimentMethod?: 'CEREBRAS' | 'LEXICON_FALLBACK' | 'DETERMINISTIC';
  storyKey?: string; storySummary?: string;
  mentionedStocks: Types.ObjectId[]; analyzedAt?: Date; createdAt: Date;
}
const schema = new Schema<IArticle>({
  publisher: { type: Schema.Types.ObjectId, ref: 'Publisher', required: true },
  title: { type: String, required: true },
  url: { type: String, required: true, unique: true, index: true },
  description: String,
  content: String,
  publishedAt: { type: Date, required: true },
  processed: { type: Boolean, default: false, index: true },
  sentimentProcessed: { type: Boolean, default: false, index: true },
  sentimentLabel: { type: String, enum: NEWS_SENTIMENT_LABELS, index: true },
  sentimentScore: { type: Number, min: -1, max: 1 },
  sentimentConfidence: { type: Number, min: 0, max: 1 },
  sentimentReason: String,
  sentimentMethod: { type: String, enum: ['CEREBRAS', 'LEXICON_FALLBACK', 'DETERMINISTIC'] },
  storyKey: { type: String, trim: true, index: true },
  storySummary: String,
  mentionedStocks: { type: [{ type: Schema.Types.ObjectId, ref: 'Stock' }], default: [], index: true },
  analyzedAt: Date,
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ sentimentProcessed: 1, publishedAt: -1 });
schema.index({ mentionedStocks: 1, publishedAt: -1 });
export const Article = model<IArticle>('Article', schema);
