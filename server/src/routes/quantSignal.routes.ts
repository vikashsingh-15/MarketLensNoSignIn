import { Router } from 'express';
import { getStockQuantSignals, listQuantSignals } from '../controllers/quantSignal.controller.js';

const router = Router();
router.get('/', listQuantSignals);
router.get('/stock/:symbol', getStockQuantSignals);
export default router;
