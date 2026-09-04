import type { Types } from 'mongoose';
import { Recommendation, type RecommendationValue } from '../../models/Recommendation.js';

export function createRecommendationKey(symbol: string, broker: string, recommendation: RecommendationValue, targetPrice: number | undefined, date: Date) {
  const day = date.toISOString().slice(0, 10);
  const clean = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${clean(symbol)}-${clean(broker)}-${recommendation}-${targetPrice ?? 'NA'}-${day}`;
}

export async function saveRecommendation(input: {
  stockId: Types.ObjectId; brokerId: Types.ObjectId; articleId?: Types.ObjectId; symbol: string; brokerName: string;
  recommendation: RecommendationValue; targetPrice?: number; previousTargetPrice?: number; date: Date; confidence: number;
}) {
  const recommendationKey = createRecommendationKey(input.symbol, input.brokerName, input.recommendation, input.targetPrice, input.date);
  const result = await Recommendation.updateOne(
    { recommendationKey },
    {
      $setOnInsert: { stock: input.stockId, broker: input.brokerId, article: input.articleId, recommendation: input.recommendation, targetPrice: input.targetPrice, previousTargetPrice: input.previousTargetPrice, recommendationDate: input.date, confidence: input.confidence, recommendationKey },
      ...(input.articleId ? { $addToSet: { articles: input.articleId } } : {}),
    },
    { upsert: true },
  );
  return { created: result.upsertedCount === 1, recommendationKey };
}
