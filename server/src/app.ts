import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import stockRoutes from './routes/stock.routes.js';
import recommendationRoutes from './routes/recommendation.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import strategyScreenRoutes from './routes/strategyScreen.routes.js';
import quantSignalRoutes from './routes/quantSignal.routes.js';
import newsRoutes from './routes/news.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: env.clientUrl }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'MarketLens API' }));
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/strategy-screens', strategyScreenRoutes);
app.use('/api/quant-signals', quantSignalRoutes);
app.use('/api/news', newsRoutes);

// Catch unmatched /api routes with JSON 404 before static serving
app.use('/api', (_req, res) => res.status(404).json({ message: 'Route not found' }));

// In production, serve the built React client
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong' });
});
