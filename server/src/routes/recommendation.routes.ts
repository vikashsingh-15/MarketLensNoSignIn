import { Router } from 'express';
import { latestRecommendations, listRecommendations } from '../controllers/recommendation.controller.js';
const router = Router();
router.get('/', listRecommendations);
router.get('/latest', latestRecommendations);
export default router;
