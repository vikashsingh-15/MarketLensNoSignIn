import type { Request, Response } from 'express';
import { refreshStockStrategyScreen, runStrategyScreenScan, stockStrategyScreens, strategyScreenOverview } from '../services/strategy/strategyScreen.service.js';

export async function listStrategyScreens(req: Request, res: Response) {
  const limit = Number(req.query.limit);
  res.json(await strategyScreenOverview({
    strategy: typeof req.query.strategy === 'string' ? req.query.strategy : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  }));
}

export async function getStockStrategyScreens(req: Request, res: Response) {
  const results = await stockStrategyScreens(String(req.params.symbol));
  if (!results) return res.status(404).json({ message: 'Stock not found' });
  res.json(results);
}

export async function refreshStockStrategyScreens(req: Request, res: Response) {
  try {
    const results = await refreshStockStrategyScreen(String(req.params.symbol));
    if (!results) return res.status(404).json({ message: 'Stock not found' });
    res.json(results);
  } catch (error) {
    console.warn(`On-demand strategy scan failed for ${String(req.params.symbol).toUpperCase()}:`, error instanceof Error ? error.message : error);
    res.status(502).json({ message: `Strategy data is temporarily unavailable for ${String(req.params.symbol).toUpperCase()}` });
  }
}

export async function refreshStrategyScreens(req: Request, res: Response) {
  const requestedLimit = Number(req.body?.limit);
  const symbols = Array.isArray(req.body?.symbols)
    ? req.body.symbols.filter((symbol: unknown): symbol is string => typeof symbol === 'string').slice(0, 100)
    : undefined;
  const result = await runStrategyScreenScan({ limit: Number.isFinite(requestedLimit) ? requestedLimit : 20, symbols });
  res.json(result);
}
