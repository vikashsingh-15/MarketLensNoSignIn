import { Router } from 'express';
import { focusEvents, listCalendarEvents, refreshCalendar } from '../controllers/calendar.controller.js';

const router = Router();
router.get('/', listCalendarEvents);
router.get('/focus', focusEvents);
router.post('/refresh', refreshCalendar);
export default router;
