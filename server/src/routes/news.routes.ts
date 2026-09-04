import { Router } from 'express';
import { newsArchive } from '../controllers/news.controller.js';

const router = Router();
router.get('/', newsArchive);
export default router;
