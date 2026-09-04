import type { Request, Response } from 'express';
import { quantSignalOverview, stockQuantSignals } from '../services/strategy/quantSignal.service.js';

export async function listQuantSignals(req: Request, res: Response) {
  const limit = Number(req.query.limit);
  res.json(await quantSignalOverview({
    engine: typeof req.query.engine === 'string' ? req.query.engine : undefined,
    signal: typeof req.query.signal === 'string' ? req.query.signal : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  }));
}

export async function getStockQuantSignals(req: Request, res: Response) {
  const result = await stockQuantSignals(String(req.params.symbol));
  if (!result) return res.status(404).json({ message: 'AI/quant signals have not been calculated for this stock' });
  res.json(result);
}
