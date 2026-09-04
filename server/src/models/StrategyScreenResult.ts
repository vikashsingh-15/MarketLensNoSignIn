import { Schema, model, type Types } from 'mongoose';

export const STRATEGY_KEYS = [
  'DEFENSIVE_VALUE',
  'GROWTH_AT_VALUE',
  'ASSET_BARGAIN',
  'TOTAL_RETURN_VALUE',
  'QUALITY_COMPOUNDER',
  'CONSISTENT_COMPOUNDER',
] as const;

export type StrategyKey = typeof STRATEGY_KEYS[number];
export type StrategyStatus = 'PASS' | 'NEAR' | 'FAIL' | 'INSUFFICIENT_DATA';

export interface IStrategyCriterion {
  key: string;
  label: string;
  value: number | null;
  displayValue: string;
  target: string;
  passed: boolean | null;
  note?: string;
}

export interface IStrategyScreenResult {
  stock: Types.ObjectId;
  strategy: StrategyKey;
  status: StrategyStatus;
  score: number;
  dataCompleteness: number;
  criteria: IStrategyCriterion[];
  source: 'Yahoo Finance';
  yahooSymbol: string;
  asOf: Date;
  createdAt: Date;
  updatedAt: Date;
}

const criterionSchema = new Schema<IStrategyCriterion>({
  key: { type: String, required: true },
  label: { type: String, required: true },
  value: { type: Number, default: null },
  displayValue: { type: String, required: true },
  target: { type: String, required: true },
  passed: { type: Boolean, default: null },
  note: String,
}, { _id: false });

const schema = new Schema<IStrategyScreenResult>({
  stock: { type: Schema.Types.ObjectId, ref: 'Stock', required: true, index: true },
  strategy: { type: String, enum: STRATEGY_KEYS, required: true, index: true },
  status: { type: String, enum: ['PASS', 'NEAR', 'FAIL', 'INSUFFICIENT_DATA'], required: true, index: true },
  score: { type: Number, min: 0, max: 100, required: true },
  dataCompleteness: { type: Number, min: 0, max: 100, required: true },
  criteria: { type: [criterionSchema], required: true },
  source: { type: String, enum: ['Yahoo Finance'], required: true },
  yahooSymbol: { type: String, required: true },
  asOf: { type: Date, required: true, index: true },
}, { timestamps: true });

schema.index({ stock: 1, strategy: 1 }, { unique: true });
schema.index({ strategy: 1, status: 1, score: -1 });

export const StrategyScreenResult = model<IStrategyScreenResult>('StrategyScreenResult', schema);
