import type { Request } from 'express';

export type RecommendationDateRange = { $gte?: Date; $lte?: Date };

export function parseIstDateOnly(value: unknown, endOfDay: boolean) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validationDate = new Date(Date.UTC(year, month - 1, day));
  if (validationDate.getUTCFullYear() !== year || validationDate.getUTCMonth() !== month - 1 || validationDate.getUTCDate() !== day) return null;
  return new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
}

export function getRecommendationDateRange(query: Request['query']): RecommendationDateRange | undefined {
  const from = parseIstDateOnly(query.from, false);
  const to = parseIstDateOnly(query.to, true);
  if (!from && !to) return undefined;
  return { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
}
