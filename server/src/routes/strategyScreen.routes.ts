import { Router } from 'express';
import { getStockStrategyScreens, listStrategyScreens, refreshStockStrategyScreens, refreshStrategyScreens } from '../controllers/strategyScreen.controller.js';

const router = Router();
router.get('/', listStrategyScreens);
router.post('/refresh', refreshStrategyScreens);
router.post('/stock/:symbol/refresh', refreshStockStrategyScreens);
router.get('/stock/:symbol', getStockStrategyScreens);
export default router;
