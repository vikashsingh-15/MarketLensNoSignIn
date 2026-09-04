import type { Types } from 'mongoose';
import { QuantSignalResult, QUANT_ENGINE_KEYS, QUANT_SIGNALS, type IQuantEngineResult, type IQuantMetric, type QuantEngineKey, type QuantSignal } from '../../models/QuantSignalResult.js';
import { Stock, type IStock } from '../../models/Stock.js';
import { getCoreMarketData, getDailyMarketHistory, type DailyMarketCandle } from '../market/yahooFinance.service.js';

type CoreData = Awaited<ReturnType<typeof getCoreMarketData>>;
type MarketHistory = Awaited<ReturnType<typeof getDailyMarketHistory>>;
export const MINIMUM_QUANT_CANDLES = 220;

export class InsufficientMarketHistoryError extends Error {
  constructor(public readonly available: number, public readonly required = MINIMUM_QUANT_CANDLES) {
    super(`Only ${available} daily candles are available; at least ${required} are required`);
    this.name = 'InsufficientMarketHistoryError';
  }
}
type NullableSeries = Array<number | null>;

export const QUANT_ENGINE_DEFINITIONS: Array<{ key: QuantEngineKey | 'META'; name: string; description: string }> = [
  { key: 'META', name: 'AI Consensus', description: 'Confidence-adjusted consensus across all available engines, with weights adapted to the detected market regime.' },
  { key: 'MEAN_REVERSION', name: 'Mean Reversion', description: 'Bollinger Bands, RSI, and Fibonacci confluence for overextended prices in ranging markets.' },
  { key: 'MULTI_FACTOR', name: 'Multi-Factor Score', description: 'Valuation, business quality, financial health, and long-term price trend in a transparent 100-point model.' },
  { key: 'TREND_BREAKOUT', name: 'Trend Breakout', description: 'EMA structure, MACD, volume confirmation, ATR, and trailing-stop risk for momentum conditions.' },
  { key: 'SMART_MONEY', name: 'Smart Money Flow', description: 'Chaikin Money Flow, OBV behaviour, volume, and reported institutional position changes.' },
  { key: 'ML_ENSEMBLE', name: 'Adaptive ML Probability', description: 'Per-stock logistic classifier estimating the probability of a 5% gain over 20 trading days.' },
];

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const number = (value: number) => value.toFixed(2);

function metric(key: string, label: string, value: number | null | undefined, format: (actual: number) => string, interpretation: string): IQuantMetric {
  const actual = finite(value) ? value : null;
  return { key, label, value: actual, displayValue: actual == null ? 'Data unavailable' : format(actual), interpretation };
}

function signalFromScore(score: number): QuantSignal {
  if (score >= 1.5) return 'STRONG_BUY';
  if (score >= 0.5) return 'BUY';
  if (score > -0.5) return 'HOLD';
  if (score > -1.5) return 'SELL';
  return 'STRONG_SELL';
}

function signalFromComposite(score: number): QuantSignal {
  if (score >= 80) return 'STRONG_BUY';
  if (score >= 65) return 'BUY';
  if (score >= 45) return 'HOLD';
  if (score >= 30) return 'SELL';
  return 'STRONG_SELL';
}

function smaAt(values: number[], period: number, index = values.length - 1) {
  if (index + 1 < period) return null;
  return average(values.slice(index - period + 1, index + 1));
}

function standardDeviationAt(values: number[], period: number, index = values.length - 1) {
  const mean = smaAt(values, period, index);
  if (mean == null) return null;
  const sample = values.slice(index - period + 1, index + 1);
  return Math.sqrt(sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
}

function emaSeries(values: number[], period: number) {
  const output: number[] = [];
  const multiplier = 2 / (period + 1);
  values.forEach((value, index) => { output.push(index === 0 ? value : value * multiplier + output[index - 1] * (1 - multiplier)); });
  return output;
}

function rsiSeries(values: number[], period = 14): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gain = 0; let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gain += Math.max(0, change); loss += Math.max(0, -change);
  }
  let averageGain = gain / period; let averageLoss = loss / period;
  output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return output;
}

function atrSeries(candles: DailyMarketCandle[], period = 14): NullableSeries {
  const ranges = candles.map((candle, index) => index === 0 ? candle.high - candle.low : Math.max(candle.high - candle.low, Math.abs(candle.high - candles[index - 1].close), Math.abs(candle.low - candles[index - 1].close)));
  const output: NullableSeries = Array(candles.length).fill(null);
  if (ranges.length < period) return output;
  let current = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  for (let index = period; index < ranges.length; index += 1) { current = (current * (period - 1) + ranges[index]) / period; output[index] = current; }
  return output;
}

function macdSeries(closes: number[]) {
  const fast = emaSeries(closes, 12); const slow = emaSeries(closes, 26);
  const line = closes.map((_value, index) => fast[index] - slow[index]);
  const signal = emaSeries(line, 9);
  return { line, signal, histogram: line.map((value, index) => value - signal[index]) };
}

function stochasticK(candles: DailyMarketCandle[], index: number, period = 14) {
  if (index + 1 < period) return null;
  const sample = candles.slice(index - period + 1, index + 1);
  const low = Math.min(...sample.map((candle) => candle.low)); const high = Math.max(...sample.map((candle) => candle.high));
  return high > low ? (candles[index].close - low) / (high - low) * 100 : 50;
}

function obvSeries(candles: DailyMarketCandle[]) {
  const output = [0];
  for (let index = 1; index < candles.length; index += 1) output.push(output[index - 1] + (candles[index].close > candles[index - 1].close ? candles[index].volume : candles[index].close < candles[index - 1].close ? -candles[index].volume : 0));
  return output;
}

function chaikinMoneyFlow(candles: DailyMarketCandle[], period = 20) {
  if (candles.length < period) return null;
  const sample = candles.slice(-period);
  const volume = sample.reduce((sum, candle) => sum + candle.volume, 0);
  if (volume <= 0) return null;
  const flow = sample.reduce((sum, candle) => {
    const range = candle.high - candle.low;
    const multiplier = range > 0 ? ((candle.close - candle.low) - (candle.high - candle.close)) / range : 0;
    return sum + multiplier * candle.volume;
  }, 0);
  return flow / volume;
}

function meanReversionEngine(candles: DailyMarketCandle[], rsiValues: NullableSeries): IQuantEngineResult {
  const closes = candles.map((candle) => candle.close); const latest = candles.at(-1)!; const prior = candles.at(-2)!;
  const middle = smaAt(closes, 20); const deviation = standardDeviationAt(closes, 20); const rsi = rsiValues.at(-1) ?? null;
  const upper = middle != null && deviation != null ? middle + 2 * deviation : null; const lower = middle != null && deviation != null ? middle - 2 * deviation : null;
  const swing = candles.slice(-60); const high = Math.max(...swing.map((candle) => candle.high)); const low = Math.min(...swing.map((candle) => candle.low));
  const fib50 = high - 0.5 * (high - low); const fib618 = high - 0.618 * (high - low);
  const supportDistance = Math.min(Math.abs(latest.close - fib50), Math.abs(latest.close - fib618)) / latest.close;
  const resistanceDistance = Math.min(Math.abs(latest.close - high), Math.abs(latest.close - (high - 0.236 * (high - low)))) / latest.close;
  const bounce = latest.close > prior.close; const rejection = latest.close < prior.close;
  let score = 0;
  if (lower != null && latest.close <= lower) score += 0.8; else if (lower != null && latest.close <= lower * 1.02) score += 0.35;
  if (upper != null && latest.close >= upper) score -= 0.8; else if (upper != null && latest.close >= upper * 0.98) score -= 0.35;
  if (rsi != null && rsi < 30) score += 0.8; else if (rsi != null && rsi < 40) score += 0.3; else if (rsi != null && rsi > 70) score -= 0.8; else if (rsi != null && rsi > 60) score -= 0.3;
  if (supportDistance <= 0.02 && bounce) score += 0.4;
  if (resistanceDistance <= 0.02 && rejection) score -= 0.4;
  score = clamp(score, -2, 2);
  const evidence = [lower != null && latest.close <= lower ? 'Price is at or below the lower Bollinger Band.' : null, rsi != null && rsi < 30 ? 'RSI is in oversold territory.' : null, supportDistance <= 0.02 && bounce ? 'Price is bouncing near 50% or 61.8% Fibonacci support.' : null, upper != null && latest.close >= upper ? 'Price is at or above the upper Bollinger Band.' : null, rsi != null && rsi > 70 ? 'RSI is in overbought territory.' : null].filter((item): item is string => item != null);
  return { key: 'MEAN_REVERSION', name: 'Mean Reversion', focus: 'Overextension and key-level confluence', signal: signalFromScore(score), score, confidence: Math.round(clamp(55 + Math.abs(score) * 20, 0, 95)), metrics: [metric('rsi14', 'RSI (14)', rsi, number, '<30 oversold; >70 overbought'), metric('lowerBand', 'Lower Bollinger Band', lower, number, 'Potential volatility support'), metric('upperBand', 'Upper Bollinger Band', upper, number, 'Potential volatility resistance'), metric('fibSupportDistance', 'Nearest Fib support distance', supportDistance, percent, 'Distance to 50% or 61.8% support')], evidence, limitations: ['Fibonacci swing points use the latest 60 sessions and are a reproducible approximation, not discretionary chart annotation.'] };
}

function multiFactorEngine(core: CoreData, candles: DailyMarketCandle[], rsiValues: NullableSeries): IQuantEngineResult {
  const closes = candles.map((candle) => candle.close); const s = core.screening; const q = core.quality;
  const sma50 = smaAt(closes, 50); const sma200 = smaAt(closes, 200); const close = closes.at(-1)!; const rsi = rsiValues.at(-1) ?? null;
  const checks: Array<{ points: number; pass: boolean | null; text: string }> = [
    { points: 15, pass: finite(core.trailingPE) ? core.trailingPE > 0 && core.trailingPE < 20 : null, text: 'Trailing P/E is below the 20x broad-market proxy.' },
    { points: 15, pass: finite(s.priceToBook) ? s.priceToBook > 0 && s.priceToBook < 2 : null, text: 'Price-to-book is below 2x.' },
    { points: 15, pass: finite(q.returnOnEquity) ? q.returnOnEquity > 0.15 : null, text: 'ROE exceeds 15%.' },
    { points: 10, pass: finite(q.debtToEquityRatio) ? q.debtToEquityRatio < 0.5 : null, text: 'Debt-to-equity is below 0.5x.' },
    { points: 10, pass: finite(q.freeCashFlow) ? q.freeCashFlow > 0 : null, text: 'Free cash flow is positive.' },
    { points: 15, pass: sma200 != null ? close > sma200 : null, text: 'Price is above its 200-day SMA.' },
    { points: 10, pass: sma50 != null && sma200 != null ? sma50 > sma200 : null, text: 'The 50-day SMA is above the 200-day SMA.' },
    { points: 10, pass: rsi != null ? rsi >= 45 && rsi <= 65 : null, text: 'RSI is within the healthy-trend range.' },
  ];
  const composite = checks.reduce((sum, check) => sum + (check.pass ? check.points : 0), 0);
  const availablePoints = checks.reduce((sum, check) => sum + (check.pass == null ? 0 : check.points), 0);
  const score = clamp((composite - 50) / 25, -2, 2);
  return { key: 'MULTI_FACTOR', name: 'Multi-Factor Score', focus: 'Valuation, quality, health, and trend', signal: availablePoints < 65 ? 'INSUFFICIENT_DATA' : signalFromComposite(composite), score: availablePoints < 65 ? 0 : score, confidence: availablePoints, metrics: [metric('composite', 'Composite score', composite, (value) => `${value.toFixed(0)}/100`, '80+ Strong Buy; 65–79 Buy; 45–64 Hold; 30–44 Sell'), metric('trailingPE', 'Trailing P/E', core.trailingPE, (value) => `${value.toFixed(2)}x`, '<20x broad-market proxy'), metric('priceToBook', 'Price to book', s.priceToBook, (value) => `${value.toFixed(2)}x`, '<2x'), metric('sma200', '200-day SMA', sma200, number, close > (sma200 || Infinity) ? 'Price above long-term trend' : 'Price below long-term trend'), metric('rsi14', 'RSI (14)', rsi, number, '45–65 supports a healthy trend')], evidence: checks.filter((check) => check.pass).map((check) => check.text), limitations: ['Yahoo does not provide a dependable industry P/E median for every NSE stock, so the valuation factor uses a transparent 20x proxy.'] };
}

function trendBreakoutEngine(candles: DailyMarketCandle[], atrValues: NullableSeries, macd: ReturnType<typeof macdSeries>): IQuantEngineResult {
  const closes = candles.map((candle) => candle.close); const ema20 = emaSeries(closes, 20); const ema50 = emaSeries(closes, 50); const latest = candles.at(-1)!; const index = candles.length - 1;
  const volumeAverage = average(candles.slice(-20).map((candle) => candle.volume)); const volumeRatio = volumeAverage ? latest.volume / volumeAverage : null;
  const bullishCross = macd.line[index] > macd.signal[index] && macd.line[index - 1] <= macd.signal[index - 1];
  const bearishCross = macd.line[index] < macd.signal[index] && macd.line[index - 1] >= macd.signal[index - 1];
  const atr = atrValues[index]; const peak = Math.max(...candles.slice(-60).map((candle) => candle.high)); const trailingStop = atr != null ? peak - 2 * atr : null;
  let score = latest.close > ema20[index] && latest.close > ema50[index] ? 0.7 : latest.close < ema50[index] ? -0.8 : 0;
  score += bullishCross ? 0.7 : bearishCross ? -0.7 : macd.line[index] > macd.signal[index] ? 0.25 : -0.25;
  if (volumeRatio != null && volumeRatio >= 1.5) score += latest.close > candles[index - 1].close ? 0.6 : -0.6;
  if (trailingStop != null && latest.close < trailingStop) score -= 0.7;
  score = clamp(score, -2, 2);
  return { key: 'TREND_BREAKOUT', name: 'Trend Breakout', focus: 'Momentum confirmation and volatility-adjusted exits', signal: signalFromScore(score), score, confidence: Math.round(clamp(55 + Math.abs(score) * 18 + (volumeRatio != null ? 5 : 0), 0, 95)), metrics: [metric('ema20', 'EMA (20)', ema20[index], number, latest.close > ema20[index] ? 'Price is above short-term trend' : 'Price is below short-term trend'), metric('ema50', 'EMA (50)', ema50[index], number, latest.close > ema50[index] ? 'Price is above medium-term trend' : 'Price is below medium-term trend'), metric('macdHistogram', 'MACD histogram', macd.histogram[index], number, macd.histogram[index] >= 0 ? 'Positive momentum' : 'Negative momentum'), metric('volumeRatio', 'Volume vs 20-day average', volumeRatio, (value) => `${value.toFixed(2)}x`, '1.5x confirms a breakout'), metric('atrStop', '2× ATR trailing stop', trailingStop, number, latest.close < (trailingStop || -Infinity) ? 'Stop condition triggered' : 'Stop not triggered')], evidence: [bullishCross ? 'MACD made a bullish crossover.' : null, bearishCross ? 'MACD made a bearish crossover.' : null, volumeRatio != null && volumeRatio >= 1.5 ? 'Volume is at least 1.5x its 20-day average.' : null, latest.close > ema20[index] && latest.close > ema50[index] ? 'Price is above both trend EMAs.' : null, trailingStop != null && latest.close < trailingStop ? 'The volatility-adjusted trailing stop is breached.' : null].filter((item): item is string => item != null), limitations: ['Daily candles can confirm end-of-day momentum but not intraday breakout quality.'] };
}

function smartMoneyEngine(core: CoreData, candles: DailyMarketCandle[]): IQuantEngineResult {
  const cmf = chaikinMoneyFlow(candles); const obv = obvSeries(candles); const latestObv = obv.at(-1)!; const priorObv = obv.slice(-21, -1);
  const obvHigh = priorObv.length ? latestObv > Math.max(...priorObv) : false; const obvLow = priorObv.length ? latestObv < Math.min(...priorObv) : false;
  const latest = candles.at(-1)!; const priceWindow = candles.slice(-20); const priceRange = (Math.max(...priceWindow.map((candle) => candle.high)) - Math.min(...priceWindow.map((candle) => candle.low))) / latest.close;
  const volumeAverage = average(priceWindow.map((candle) => candle.volume)); const volumeRatio = volumeAverage ? latest.volume / volumeAverage : null;
  const institutionChange = core.screening.institutionPositionChange; let score = 0;
  if (cmf != null && cmf > 0.15) score += 0.8; else if (cmf != null && cmf < -0.15) score -= 0.8;
  if (obvHigh && priceRange <= 0.12) score += 0.8; if (obvLow) score -= 0.8;
  if (institutionChange != null && institutionChange > 0.01) score += 0.4; else if (institutionChange != null && institutionChange < -0.01) score -= 0.4;
  if (volumeRatio != null && volumeRatio > 1.2 && latest.close < candles.at(-2)!.close) score -= 0.3;
  score = clamp(score, -2, 2);
  const confidence = Math.round(clamp(50 + (institutionChange != null ? 15 : 0) + Math.abs(score) * 15, 0, 90));
  return { key: 'SMART_MONEY', name: 'Smart Money Flow', focus: 'Volume pressure and reported institutional positioning', signal: signalFromScore(score), score, confidence, metrics: [metric('cmf20', 'Chaikin Money Flow (20)', cmf, number, '>+0.15 accumulation; <-0.15 distribution'), metric('obvBreakout', 'OBV 20-day breakout', obvHigh ? 1 : obvLow ? -1 : 0, (value) => value > 0 ? 'New high' : value < 0 ? 'New low' : 'Inside range', 'OBV direction relative to its prior 20 sessions'), metric('institutionChange', 'Reported institution position change', institutionChange, percent, 'Estimated from Yahoo holder position reports'), metric('institutionOwnership', 'Institutional ownership', core.screening.institutionalOwnership, percent, 'Current reported ownership context'), metric('volumeRatio', 'Volume vs 20-day average', volumeRatio, (value) => `${value.toFixed(2)}x`, 'Higher volume strengthens the flow signal')], evidence: [cmf != null && cmf > 0.15 ? 'CMF shows strong buying pressure.' : null, cmf != null && cmf < -0.15 ? 'CMF shows strong selling pressure.' : null, obvHigh && priceRange <= 0.12 ? 'OBV reached a new 20-day high while price remained in a base.' : null, obvLow ? 'OBV broke to a new 20-day low.' : null, institutionChange != null && institutionChange > 0.01 ? 'Reported institutional positions increased.' : null, institutionChange != null && institutionChange < -0.01 ? 'Reported institutional positions decreased.' : null].filter((item): item is string => item != null), limitations: ['Yahoo holder reports are periodic and incomplete; this is not a complete FII/DII flow feed.', 'Institutional position change is estimated from reported holder rows, not exchange-level daily custody data.'] };
}

interface MlDataset { features: number[][]; labels: number[]; current: number[] }

function mlDataset(candles: DailyMarketCandle[], rsi: NullableSeries, atr: NullableSeries, macd: ReturnType<typeof macdSeries>): MlDataset | null {
  const closes = candles.map((candle) => candle.close);
  const featureAt = (index: number) => {
    if (index < 200 || !finite(rsi[index]) || !finite(rsi[index - 5]) || !finite(atr[index])) return null;
    const mean = smaAt(closes, 20, index); const deviation = standardDeviationAt(closes, 20, index); const volumeMean = average(candles.slice(index - 19, index + 1).map((candle) => candle.volume));
    const k = stochasticK(candles, index); const k1 = stochasticK(candles, index - 1); const k2 = stochasticK(candles, index - 2);
    if (mean == null || deviation == null || mean === 0 || k == null || k1 == null || k2 == null || !volumeMean) return null;
    const lower = mean - 2 * deviation; const width = 4 * deviation;
    return [atr[index]! / closes[index], width / mean, width > 0 ? (closes[index] - lower) / width : 0.5, closes[index] / closes[index - 5] - 1, closes[index] / closes[index - 20] - 1, k / 100, (k + k1 + k2) / 300, rsi[index]! / 100, (rsi[index]! - rsi[index - 5]!) / 100, macd.histogram[index] / closes[index], candles[index].volume / volumeMean];
  };
  const features: number[][] = []; const labels: number[] = [];
  for (let index = 200; index < candles.length - 20; index += 1) {
    const row = featureAt(index); if (!row || row.some((value) => !Number.isFinite(value))) continue;
    features.push(row); labels.push(closes[index + 20] / closes[index] - 1 >= 0.05 ? 1 : 0);
  }
  const current = featureAt(candles.length - 1);
  return current ? { features: features.slice(-500), labels: labels.slice(-500), current } : null;
}

function sigmoid(value: number) { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }

function mlEngine(candles: DailyMarketCandle[], rsi: NullableSeries, atr: NullableSeries, macd: ReturnType<typeof macdSeries>) {
  const data = mlDataset(candles, rsi, atr, macd);
  const emptyDiagnostics = { trainingSamples: 0, validationSamples: 0, validationAccuracy: null, positiveClassRate: null, horizonTradingDays: 20, targetReturn: 0.05 };
  if (!data || data.features.length < 150) return { engine: { key: 'ML_ENSEMBLE', name: 'Adaptive ML Probability', focus: 'Probability of a 5% gain over 20 trading days', signal: 'INSUFFICIENT_DATA', score: 0, confidence: 0, metrics: [metric('probability', 'P(20-day return ≥ 5%)', null, percent, 'Requires sufficient historical samples')], evidence: [], limitations: ['At least 150 labeled daily samples are required.'] } satisfies IQuantEngineResult, diagnostics: emptyDiagnostics };
  const split = Math.floor(data.features.length * 0.8); const trainX = data.features.slice(0, split); const trainY = data.labels.slice(0, split); const validationX = data.features.slice(split); const validationY = data.labels.slice(split);
  const dimensions = trainX[0].length; const means = Array.from({ length: dimensions }, (_unused, column) => average(trainX.map((row) => row[column])) || 0);
  const deviations = means.map((mean, column) => Math.sqrt(trainX.reduce((sum, row) => sum + (row[column] - mean) ** 2, 0) / trainX.length) || 1);
  const normalize = (row: number[]) => row.map((value, column) => (value - means[column]) / deviations[column]);
  const normalizedTrain = trainX.map(normalize); const normalizedValidation = validationX.map(normalize); const weights = Array(dimensions + 1).fill(0);
  const positiveCount = trainY.reduce((sum, value) => sum + value, 0); const negativeCount = trainY.length - positiveCount;
  if (positiveCount < 10 || negativeCount < 10) return { engine: { key: 'ML_ENSEMBLE', name: 'Adaptive ML Probability', focus: 'Probability of a 5% gain over 20 trading days', signal: 'INSUFFICIENT_DATA', score: 0, confidence: 0, metrics: [metric('probability', 'P(20-day return ≥ 5%)', null, percent, 'Class history is too imbalanced')], evidence: [], limitations: ['The stock lacks enough examples in both outcome classes for stable training.'] } satisfies IQuantEngineResult, diagnostics: { ...emptyDiagnostics, trainingSamples: trainY.length, validationSamples: validationY.length, positiveClassRate: positiveCount / trainY.length } };
  const positiveWeight = trainY.length / (2 * positiveCount); const negativeWeight = trainY.length / (2 * negativeCount);
  for (let epoch = 0; epoch < 60; epoch += 1) {
    const gradient = Array(weights.length).fill(0);
    normalizedTrain.forEach((row, index) => {
      const probability = sigmoid(weights[0] + row.reduce((sum, value, column) => sum + value * weights[column + 1], 0));
      const sampleWeight = trainY[index] ? positiveWeight : negativeWeight; const error = (probability - trainY[index]) * sampleWeight;
      gradient[0] += error; row.forEach((value, column) => { gradient[column + 1] += error * value; });
    });
    weights.forEach((_weight, index) => { weights[index] -= 0.08 * (gradient[index] / normalizedTrain.length + (index ? 0.001 * weights[index] : 0)); });
  }
  const predict = (row: number[]) => sigmoid(weights[0] + row.reduce((sum, value, column) => sum + value * weights[column + 1], 0));
  let truePositive = 0; let falseNegative = 0; let trueNegative = 0; let falsePositive = 0;
  normalizedValidation.forEach((row, index) => { const predicted = predict(row) >= 0.5; const actual = Boolean(validationY[index]); if (predicted && actual) truePositive += 1; else if (!predicted && actual) falseNegative += 1; else if (!predicted && !actual) trueNegative += 1; else falsePositive += 1; });
  const sensitivity = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0; const specificity = trueNegative + falsePositive ? trueNegative / (trueNegative + falsePositive) : 0;
  const validationAccuracy = (sensitivity + specificity) / 2; const probability = predict(normalize(data.current)); const reliable = validationY.length >= 30 && validationAccuracy >= 0.52;
  let signal: QuantSignal = probability >= 0.75 && validationAccuracy >= 0.80 ? 'STRONG_BUY' : probability >= 0.60 ? 'BUY' : probability >= 0.40 ? 'HOLD' : probability > 0.25 ? 'SELL' : 'STRONG_SELL';
  if (!reliable) signal = 'INSUFFICIENT_DATA';
  const score = reliable ? clamp((probability - 0.5) * 4, -2, 2) : 0;
  return { engine: { key: 'ML_ENSEMBLE', name: 'Adaptive ML Probability', focus: 'Probability of a 5% gain over 20 trading days', signal, score, confidence: reliable ? Math.round(validationAccuracy * 100) : Math.round(validationAccuracy * 100), metrics: [metric('probability', 'P(20-day return ≥ 5%)', probability, percent, 'Model probability from the latest feature vector'), metric('validationAccuracy', 'Chronological balanced accuracy', validationAccuracy, percent, 'Out-of-sample validation; 52% minimum to contribute'), metric('samples', 'Training samples', trainY.length, (value) => value.toFixed(0), 'Historical labeled examples')], evidence: reliable ? [`The model was trained on ${trainY.length} samples and tested on ${validationY.length} later samples.`, `The latest estimated upside probability is ${percent(probability)}.`] : [], limitations: [!reliable ? 'Chronological validation did not clear the minimum reliability gate, so this model is excluded from consensus.' : '', 'This is a lightweight per-stock logistic classifier, not a guarantee or a cross-market institutional ML model.', 'Point-in-time historical fundamentals are excluded to avoid look-ahead bias; the ML feature set uses price and volume only.'].filter(Boolean) } satisfies IQuantEngineResult, diagnostics: { trainingSamples: trainY.length, validationSamples: validationY.length, validationAccuracy, positiveClassRate: positiveCount / trainY.length, horizonTradingDays: 20, targetReturn: 0.05 } };
}

export function evaluateQuantSignals(core: CoreData, history: MarketHistory) {
  const candles = history.candles;
  if (candles.length < MINIMUM_QUANT_CANDLES) throw new InsufficientMarketHistoryError(candles.length);
  const closes = candles.map((candle) => candle.close); const rsi = rsiSeries(closes); const atr = atrSeries(candles); const macd = macdSeries(closes);
  const engines = [meanReversionEngine(candles, rsi), multiFactorEngine(core, candles, rsi), trendBreakoutEngine(candles, atr, macd), smartMoneyEngine(core, candles)];
  const ml = mlEngine(candles, rsi, atr, macd); engines.push(ml.engine);
  const ema20 = emaSeries(closes, 20).at(-1)!; const ema50 = emaSeries(closes, 50).at(-1)!; const latestAtr = atr.at(-1);
  const trendStrength = latestAtr && latestAtr > 0 ? Math.abs(ema20 - ema50) / latestAtr : 1;
  const regime: 'TRENDING' | 'RANGING' | 'MIXED' = trendStrength > 1.5 ? 'TRENDING' : trendStrength < 0.75 ? 'RANGING' : 'MIXED';
  const baseWeights: Record<QuantEngineKey, number> = regime === 'TRENDING'
    ? { MEAN_REVERSION: 0.10, MULTI_FACTOR: 0.24, TREND_BREAKOUT: 0.32, SMART_MONEY: 0.18, ML_ENSEMBLE: 0.16 }
    : regime === 'RANGING'
      ? { MEAN_REVERSION: 0.30, MULTI_FACTOR: 0.25, TREND_BREAKOUT: 0.12, SMART_MONEY: 0.18, ML_ENSEMBLE: 0.15 }
      : { MEAN_REVERSION: 0.18, MULTI_FACTOR: 0.27, TREND_BREAKOUT: 0.22, SMART_MONEY: 0.18, ML_ENSEMBLE: 0.15 };
  const effective = engines.map((engine) => ({ engine: engine.key, raw: engine.signal === 'INSUFFICIENT_DATA' ? 0 : baseWeights[engine.key] * engine.confidence / 100 }));
  const weightTotal = effective.reduce((sum, item) => sum + item.raw, 0);
  const weights = effective.map((item) => ({ engine: item.engine, weight: weightTotal ? item.raw / weightTotal : 0 }));
  const metaScore = clamp(engines.reduce((sum, engine) => sum + engine.score * (weights.find((item) => item.engine === engine.key)?.weight || 0), 0), -2, 2);
  const metaConfidence = Math.round(engines.reduce((sum, engine) => sum + engine.confidence * (weights.find((item) => item.engine === engine.key)?.weight || 0), 0));
  return { engines, meta: { signal: metaConfidence < 40 ? 'INSUFFICIENT_DATA' as const : signalFromScore(metaScore), score: metaScore, confidence: metaConfidence, regime, weights }, mlDiagnostics: ml.diagnostics, source: 'Yahoo Finance' as const, yahooSymbol: history.yahooSymbol, candleCount: candles.length, latestCandleDate: new Date(candles.at(-1)!.date), asOf: new Date() };
}

export async function calculateAndSaveQuantSignals(stock: IStock & { _id: Types.ObjectId }, core?: CoreData) {
  const [resolvedCore, history] = await Promise.all([core || getCoreMarketData(stock), getDailyMarketHistory(stock)]);
  const result = evaluateQuantSignals(resolvedCore, history);
  await QuantSignalResult.updateOne({ stock: stock._id }, { $set: result }, { upsert: true });
  return result;
}

export async function quantSignalOverview(query: { engine?: string; signal?: string; limit?: number }) {
  const engine = query.engine === 'META' || QUANT_ENGINE_KEYS.includes(query.engine as QuantEngineKey) ? query.engine : 'META';
  const signal = QUANT_SIGNALS.includes(query.signal as QuantSignal) ? query.signal : undefined;
  const filter: Record<string, unknown> = signal ? engine === 'META' ? { 'meta.signal': signal } : { engines: { $elemMatch: { key: engine, signal } } } : {};
  const limit = Math.max(1, Math.min(query.limit || 500, 2500));
  const [results, engineCounts, metaCounts, coveredStockIds, totalStocks, newest] = await Promise.all([
    QuantSignalResult.find(filter).sort({ 'meta.score': -1, asOf: -1 }).limit(limit).populate('stock').lean(),
    QuantSignalResult.aggregate<{ _id: { engine: QuantEngineKey; signal: QuantSignal }; count: number }>([{ $unwind: '$engines' }, { $group: { _id: { engine: '$engines.key', signal: '$engines.signal' }, count: { $sum: 1 } } }]),
    QuantSignalResult.aggregate<{ _id: QuantSignal; count: number }>([{ $group: { _id: '$meta.signal', count: { $sum: 1 } } }]),
    QuantSignalResult.distinct('stock'), Stock.countDocuments({ active: { $ne: false } }), QuantSignalResult.findOne().sort({ asOf: -1 }).select('asOf').lean(),
  ]);
  return { engines: QUANT_ENGINE_DEFINITIONS, results, engineCounts, metaCounts, coverage: { scannedStocks: coveredStockIds.length, totalStocks }, lastUpdated: newest?.asOf || null };
}

export async function stockQuantSignals(symbol: string) {
  const normalized = symbol.toUpperCase();
  const stock = await Stock.findOne({ active: { $ne: false }, $or: [{ symbol: normalized }, { aliases: normalized }] }).select('_id').lean();
  if (!stock) return null;
  return QuantSignalResult.findOne({ stock: stock._id }).lean();
}
