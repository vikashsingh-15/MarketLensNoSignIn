export type RecommendationValue = 'BUY' | 'HOLD' | 'SELL';
export interface CalendarEventHint { _id: string; date: string; eventTypes: CorporateEventType[]; purpose: string; status: 'SCHEDULED' | 'REVISED' }
export interface Stock { _id: string; symbol: string; companyName: string; exchange: string; aliases?: string[]; calendarEvents?: CalendarEventHint[] }
export interface Broker { _id: string; name: string }
export interface Publisher { _id: string; name: string; website?: string }
export type NewsSentimentLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export interface Article { _id: string; title: string; url: string; description?: string; publishedAt: string; processed: boolean; publisher?: Publisher; sentimentLabel?: NewsSentimentLabel; sentimentScore?: number; sentimentConfidence?: number; sentimentReason?: string }
export interface MarketMood { score: number; index: number; label: NewsSentimentLabel; counts: Record<NewsSentimentLabel, number>; articleCount: number; rawArticleCount?: number; windowHours?: number; asOf?: string }
export type NewsSentimentMethod = 'CEREBRAS' | 'LEXICON_FALLBACK' | 'DETERMINISTIC';
export interface NewsStorySource { publisher?: Publisher; url: string; title: string; publishedAt: string }
export interface NewsStory { _id: string; storyKey: string; title: string; summary: string; publishedAt: string; sentimentLabel: NewsSentimentLabel; sentimentScore: number; sentimentConfidence: number; sentimentMethod?: NewsSentimentMethod; mentionedStocks: Stock[]; sources: NewsStorySource[]; articleCount: number }
export interface MarketNewsHighlights { bullish: NewsStory[]; bearish: NewsStory[]; windowHours: number; asOf: string }
export interface NewsSentimentArticle extends Article { sentimentLabel: NewsSentimentLabel; sentimentScore: number; sentimentConfidence: number; sentimentReason?: string; sentimentMethod: NewsSentimentMethod; mentionedStocks: Stock[]; analyzedAt?: string }
export interface StockNewsSentiment { stock: Stock; summary: MarketMood; items: NewsStory[] }
export interface NewsArchive { stock: Stock | null; items: NewsStory[]; counts: Record<NewsSentimentLabel | 'ALL', number>; pagination: { page: number; limit: number; total: number; pages: number } }
export interface Recommendation { _id: string; stock: Stock; broker: Broker; article?: Article; articles?: Article[]; recommendation: RecommendationValue; targetPrice?: number; previousTargetPrice?: number; recommendationDate: string; confidence: number }
export interface Analytics { stock: Stock; uniqueBrokerCount: number; buyCount: number; holdCount: number; sellCount: number; totalRecommendations: number; buyPercentage: number; holdPercentage: number; sellPercentage: number; averageTarget: number | null; medianTarget: number | null; consensus: RecommendationValue }
export interface DashboardData { summary: { recommendationsToday: number; stocksCovered: number; buyRecommendations: number; sellRecommendations: number }; freshness: { latestRecommendationDate: string | null }; hotStocks: Analytics[]; strongBuys: Analytics[]; latest: Recommendation[]; marketMood: MarketMood; marketNews: MarketNewsHighlights }
export interface CacheMetadata { status: 'HIT' | 'REFRESHED' | 'STALE_FALLBACK'; fetchedAt: string; expiresAt: string; stale: boolean }
export interface YahooRecommendationTrend { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
export interface StockMarketData {
  source: 'Yahoo Finance'; yahooSymbol: string; updatedAt: string; marketTime: string | null; exchangeDelayMinutes: number | null; currency: string;
  currentPrice: number | null; previousClose: number | null; change: number | null; changePercent: number | null;
  fiftyTwoWeekLow: number | null; fiftyTwoWeekHigh: number | null; rangePositionPercent: number | null;
  dayHigh: number | null; dayLow: number | null; dayRangePositionPercent: number | null;
  volume: number | null; averageVolume: number | null;
  trailingPE: number | null; forwardPE: number | null; marketCap: number | null;
  analystTarget: { mean: number | null; median: number | null; low: number | null; high: number | null; analystCount: number | null; upsidePercent: number | null };
  yahooRecommendation: { key: string | null; mean: number | null; trend: YahooRecommendationTrend | null };
  quality: { returnOnEquity: number | null; debtToEquityRatio: number | null; freeCashFlow: number | null; operatingMargin: number | null; pegRatio: number | null };
  cache: { quote: CacheMetadata; fundamentals: CacheMetadata };
}
export interface StockAdvancedMarketData {
  source: 'Yahoo Finance'; yahooSymbol: string; updatedAt: string; enterpriseToEbitda: number | null; beta: number | null;
  institutionalOwnership: number | null; institutionCount: number | null; dividendYield: number | null; payoutRatio: number | null;
  insiderActivity: null | { period: string; buyCount: number; buyShares: number; sellCount: number; sellShares: number | null; netCount: number; netShares: number; netPercentInsiderShares: number | null };
  cache: CacheMetadata;
}
export type CorporateEventType = 'EARNINGS' | 'DIVIDEND' | 'MERGER' | 'BUYBACK' | 'BONUS' | 'SPLIT' | 'FUND_RAISE' | 'AGM' | 'BOARD_MEETING' | 'OTHER';
export interface CorporateEvent { _id: string; stock?: Stock; source: 'BSE' | 'YAHOO' | 'NSE'; bseCode?: string; securityName: string; eventType: CorporateEventType; eventTypes?: CorporateEventType[]; purpose: string; eventDate: string; status: 'SCHEDULED' | 'REVISED'; sourceUrl: string; dividendAmount?: number }
export interface CalendarFocus { date: string; events: CorporateEvent[]; total: number }
export type StrategyKey = 'DEFENSIVE_VALUE' | 'GROWTH_AT_VALUE' | 'ASSET_BARGAIN' | 'TOTAL_RETURN_VALUE' | 'QUALITY_COMPOUNDER' | 'CONSISTENT_COMPOUNDER';
export type StrategyStatus = 'PASS' | 'NEAR' | 'FAIL' | 'INSUFFICIENT_DATA';
export interface StrategyDefinition { key: StrategyKey; name: string; inspiredBy: string; description: string }
export interface StrategyCriterion { key: string; label: string; value: number | null; displayValue: string; target: string; passed: boolean | null; note?: string }
export interface StrategyScreenResult { _id: string; stock: Stock | string; strategy: StrategyKey; status: StrategyStatus; score: number; dataCompleteness: number; criteria: StrategyCriterion[]; source: 'Yahoo Finance'; yahooSymbol: string; asOf: string }
export interface StrategyScreenOverview {
  strategies: StrategyDefinition[];
  results: StrategyScreenResult[];
  counts: Array<{ _id: { strategy: StrategyKey; status: StrategyStatus }; count: number }>;
  coverage: { scannedStocks: number; totalStocks: number };
  lastUpdated: string | null;
}
export type QuantEngineKey = 'MEAN_REVERSION' | 'MULTI_FACTOR' | 'TREND_BREAKOUT' | 'SMART_MONEY' | 'ML_ENSEMBLE';
export type QuantSignal = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | 'INSUFFICIENT_DATA';
export interface QuantMetric { key: string; label: string; value: number | null; displayValue: string; interpretation: string }
export interface QuantEngineResult { key: QuantEngineKey; name: string; focus: string; signal: QuantSignal; score: number; confidence: number; metrics: QuantMetric[]; evidence: string[]; limitations: string[] }
export interface QuantSignalResult {
  _id: string; stock: Stock | string; engines: QuantEngineResult[];
  meta: { signal: QuantSignal; score: number; confidence: number; regime: 'TRENDING' | 'RANGING' | 'MIXED'; weights: Array<{ engine: QuantEngineKey; weight: number }> };
  mlDiagnostics: { trainingSamples: number; validationSamples: number; validationAccuracy: number | null; positiveClassRate: number | null; horizonTradingDays: number; targetReturn: number };
  source: 'Yahoo Finance'; yahooSymbol: string; candleCount: number; latestCandleDate: string; asOf: string;
}
export interface QuantSignalOverview {
  engines: Array<{ key: QuantEngineKey | 'META'; name: string; description: string }>;
  results: QuantSignalResult[];
  engineCounts: Array<{ _id: { engine: QuantEngineKey; signal: QuantSignal }; count: number }>;
  metaCounts: Array<{ _id: QuantSignal; count: number }>;
  coverage: { scannedStocks: number; totalStocks: number };
  lastUpdated: string | null;
}
