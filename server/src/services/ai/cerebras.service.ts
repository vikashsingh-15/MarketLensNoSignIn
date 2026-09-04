import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { z } from 'zod';
import { env } from '../../config/env.js';

const ratingSchema = z.enum(['BUY', 'HOLD', 'SELL']);
const sentimentSchema = z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']);
const extractionSchema = z.object({
  containsRecommendation: z.boolean().optional(),
  company: z.string().nullish(),
  ticker: z.string().nullish(),
  broker: z.string().nullish(),
  recommendation: ratingSchema.nullish(),
  rating: ratingSchema.nullish(),
  targetPrice: z.number().nonnegative().nullish(),
  previousTargetPrice: z.number().nonnegative().nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  sentimentLabel: sentimentSchema.nullish(),
  sentimentScore: z.number().min(-1).max(1).nullish(),
  sentimentConfidence: z.number().min(0).max(1).nullish(),
  sentimentReason: z.string().max(280).nullish(),
  storyKey: z.string().max(120).nullish(),
  storySummary: z.string().max(320).nullish(),
  mentionedTickers: z.array(z.string()).max(20).nullish(),
  mentionedCompanies: z.array(z.string()).max(20).nullish(),
}).transform(({ rating, ...extraction }) => {
  const recommendation = extraction.recommendation ?? rating ?? null;
  const sentimentScore = Math.max(-1, Math.min(1, extraction.sentimentScore ?? 0));
  const sentimentLabel = sentimentScore > 0.15 ? 'BULLISH' as const : sentimentScore < -0.15 ? 'BEARISH' as const : 'NEUTRAL' as const;
  return {
    ...extraction,
    containsRecommendation: extraction.containsRecommendation
      ?? Boolean(extraction.broker && recommendation && (extraction.ticker || extraction.company)),
    recommendation,
    confidence: extraction.confidence ?? 0.5,
    sentimentLabel,
    sentimentScore,
    sentimentConfidence: extraction.sentimentConfidence ?? 0.5,
    sentimentReason: extraction.sentimentReason || 'No concise sentiment explanation was returned.',
    storyKey: extraction.storyKey?.trim().toLowerCase() || null,
    storySummary: extraction.storySummary?.trim() || extraction.sentimentReason || null,
    mentionedTickers: [...new Set(extraction.mentionedTickers || [])],
    mentionedCompanies: [...new Set(extraction.mentionedCompanies || [])],
  };
});
export type RecommendationExtraction = z.infer<typeof extractionSchema>;

const SYSTEM_PROMPT = `You extract stock analyst recommendations from financial news, primarily Indian market news.
Return valid JSON only, with no markdown.
Return exactly these JSON keys: containsRecommendation, company, ticker, broker, recommendation, targetPrice, previousTargetPrice, confidence, sentimentLabel, sentimentScore, sentimentConfidence, sentimentReason, storyKey, storySummary, mentionedTickers, mentionedCompanies.
The recommendation value must be BUY, HOLD, SELL, or null. Use recommendation as the key name, never rating.
Use null for unknown optional values and a confidence number from 0 to 1.
The publisher reporting the article is NOT necessarily the broker. Do not invent missing information.
Set containsRecommendation=true only when an institutional broker or research firm is explicitly named together with a stock rating. Individual expert commentary, technical trading ideas, and generic stocks-to-watch articles are not broker recommendations.
Normalize equivalent positive ratings to BUY, neutral ratings to HOLD, and negative ratings to SELL.
Classify the article's likely effect on the Indian equity market as BULLISH, BEARISH, or NEUTRAL. sentimentScore must be between -1 and +1, where -1 is strongly bearish, 0 is balanced/irrelevant, and +1 is strongly bullish. Base it on concrete economic, earnings, policy, demand, risk, and price-impact information; do not treat dramatic wording alone as sentiment.
List only explicitly mentioned listed-company tickers and company names. Do not invent a ticker from an ambiguous acronym.
Create storyKey as a stable lowercase hyphen-separated description of the underlying event using the main entity and action, not the publisher or headline wording. Similar reports about the same event should produce the same key, for example bse-jefferies-underperform-downgrade. storySummary must be one concise factual summary suitable for combined coverage from multiple publishers.
When no explicit broker recommendation exists, set the recommendation fields to null while still returning sentiment and mentioned-stock fields.`;

class CerebrasService {
  private client: Cerebras | null = null;

  private getClient() {
    if (!env.cerebrasApiKey) throw new Error('CEREBRAS_API_KEY is not configured');
    this.client ??= new Cerebras({ apiKey: env.cerebrasApiKey });
    return this.client;
  }

  async analyzeArticle(text: string): Promise<RecommendationExtraction> {
    const completion = await this.getClient().chat.completions.create({
      model: env.cerebrasModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 14000) },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const content = (completion as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') throw new Error('Cerebras returned an empty response');
    const parsed = extractionSchema.parse(JSON.parse(content));
    if (parsed.containsRecommendation && (!parsed.broker || !parsed.recommendation || (!parsed.ticker && !parsed.company))) {
      console.warn('Cerebras omitted required recommendation fields; skipping it safely.', {
        hasCompany: Boolean(parsed.company),
        hasTicker: Boolean(parsed.ticker),
        hasBroker: Boolean(parsed.broker),
        hasRecommendation: Boolean(parsed.recommendation),
      });
      return { ...parsed, containsRecommendation: false, recommendation: null };
    }
    return parsed;
  }

  async extract(text: string) { return this.analyzeArticle(text); }
}

export const cerebrasService = new CerebrasService();
