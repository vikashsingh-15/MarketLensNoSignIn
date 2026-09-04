import { Schema, model, type Types } from 'mongoose';

export const QUANT_ENGINE_KEYS = ['MEAN_REVERSION', 'MULTI_FACTOR', 'TREND_BREAKOUT', 'SMART_MONEY', 'ML_ENSEMBLE'] as const;
export const QUANT_SIGNALS = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL', 'INSUFFICIENT_DATA'] as const;
export type QuantEngineKey = typeof QUANT_ENGINE_KEYS[number];
export type QuantSignal = typeof QUANT_SIGNALS[number];

export interface IQuantMetric { key: string; label: string; value: number | null; displayValue: string; interpretation: string }
export interface IQuantEngineResult {
  key: QuantEngineKey; name: string; focus: string; signal: QuantSignal; score: number; confidence: number;
  metrics: IQuantMetric[]; evidence: string[]; limitations: string[];
}
export interface IQuantSignalResult {
  stock: Types.ObjectId; engines: IQuantEngineResult[];
  meta: { signal: QuantSignal; score: number; confidence: number; regime: 'TRENDING' | 'RANGING' | 'MIXED'; weights: Array<{ engine: QuantEngineKey; weight: number }> };
  mlDiagnostics: { trainingSamples: number; validationSamples: number; validationAccuracy: number | null; positiveClassRate: number | null; horizonTradingDays: number; targetReturn: number };
  source: 'Yahoo Finance'; yahooSymbol: string; candleCount: number; latestCandleDate: Date; asOf: Date; createdAt: Date; updatedAt: Date;
}

const metricSchema = new Schema<IQuantMetric>({
  key: { type: String, required: true }, label: { type: String, required: true }, value: { type: Number, default: null },
  displayValue: { type: String, required: true }, interpretation: { type: String, required: true },
}, { _id: false });
const engineSchema = new Schema<IQuantEngineResult>({
  key: { type: String, enum: QUANT_ENGINE_KEYS, required: true }, name: { type: String, required: true }, focus: { type: String, required: true },
  signal: { type: String, enum: QUANT_SIGNALS, required: true }, score: { type: Number, min: -2, max: 2, required: true },
  confidence: { type: Number, min: 0, max: 100, required: true }, metrics: { type: [metricSchema], required: true },
  evidence: { type: [String], default: [] }, limitations: { type: [String], default: [] },
}, { _id: false });
const weightSchema = new Schema({ engine: { type: String, enum: QUANT_ENGINE_KEYS, required: true }, weight: { type: Number, required: true } }, { _id: false });
const schema = new Schema<IQuantSignalResult>({
  stock: { type: Schema.Types.ObjectId, ref: 'Stock', required: true, unique: true, index: true },
  engines: { type: [engineSchema], required: true },
  meta: {
    signal: { type: String, enum: QUANT_SIGNALS, required: true }, score: { type: Number, min: -2, max: 2, required: true },
    confidence: { type: Number, min: 0, max: 100, required: true }, regime: { type: String, enum: ['TRENDING', 'RANGING', 'MIXED'], required: true },
    weights: { type: [weightSchema], required: true },
  },
  mlDiagnostics: {
    trainingSamples: { type: Number, required: true }, validationSamples: { type: Number, required: true }, validationAccuracy: { type: Number, default: null },
    positiveClassRate: { type: Number, default: null }, horizonTradingDays: { type: Number, default: 20 }, targetReturn: { type: Number, default: 0.05 },
  },
  source: { type: String, enum: ['Yahoo Finance'], required: true }, yahooSymbol: { type: String, required: true }, candleCount: { type: Number, required: true },
  latestCandleDate: { type: Date, required: true }, asOf: { type: Date, required: true, index: true },
}, { timestamps: true });
schema.index({ 'meta.signal': 1, 'meta.score': -1 });
schema.index({ 'engines.key': 1, 'engines.signal': 1 });
export const QuantSignalResult = model<IQuantSignalResult>('QuantSignalResult', schema);
