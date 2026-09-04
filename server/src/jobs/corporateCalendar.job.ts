import type { Agenda } from 'agenda';
import { runCalendarRefresh } from '../services/calendar/calendarRefresh.service.js';

export function defineCorporateCalendarJob(agenda: Agenda) {
  agenda.define('sync-corporate-calendar', async () => {
    const { summary, yahoo, nse } = await runCalendarRefresh();
    console.log('BSE calendar sync summary:', summary);
    console.log('Yahoo Finance calendar sync summary:', yahoo);
    console.log('NSE corporate actions sync summary:', nse);
  });
}
