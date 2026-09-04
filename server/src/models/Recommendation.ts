import { Schema, model, type Types } from 'mongoose';
export type RecommendationValue = 'BUY' | 'HOLD' | 'SELL';
export interface IRecommendation { stock: Types.ObjectId; broker: Types.ObjectId; article?: Types.ObjectId; articles: Types.ObjectId[]; recommendation: RecommendationValue; targetPrice?: number; previousTargetPrice?: number; recommendationDate: Date; confidence: number; recommendationKey: string; createdAt: Date; updatedAt: Date }
const schema = new Schema<IRecommendation>({
  stock: { type: Schema.Types.ObjectId, ref: 'Stock', required: true, index: true },
  broker: { type: Schema.Types.ObjectId, ref: 'Broker', required: true, index: true },
  // `article` remains for backward compatibility; `articles` preserves every publisher source.
  article: { type: Schema.Types.ObjectId, ref: 'Article' },
  articles: { type: [{ type: Schema.Types.ObjectId, ref: 'Article' }], default: [] },
  recommendation: { type: String, enum: ['BUY', 'HOLD', 'SELL'], required: true },
  targetPrice: Number,
  previousTargetPrice: Number,
  recommendationDate: { type: Date, required: true, index: true },
  confidence: { type: Number, min: 0, max: 1, default: 0.5 },
  recommendationKey: { type: String, required: true, unique: true, index: true },
}, { timestamps: true });
export const Recommendation = model<IRecommendation>('Recommendation', schema);
