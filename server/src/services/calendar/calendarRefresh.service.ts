import { syncBseCalendar } from './bseCalendar.service.js';
import { syncNseCalendar } from './nseCalendar.service.js';
import { syncYahooCalendar } from './yahooCalendar.service.js';

export type CalendarRefreshResult = {
  message: string;
  summary: Awaited<ReturnType<typeof syncBseCalendar>>;
  yahoo: Awaited<ReturnType<typeof syncYahooCalendar>>;
  nse: Awaited<ReturnType<typeof syncNseCalendar>>;
};

export type CalendarRefreshStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  result: CalendarRefreshResult | null;
  error: string | null;
};

let activeCalendarRefresh: Promise<CalendarRefreshResult> | null = null;
let calendarRefreshStatus: CalendarRefreshStatus = {
  state: 'idle', startedAt: null, completedAt: null, result: null, error: null,
};

export function getCalendarRefreshStatus() {
  return { ...calendarRefreshStatus };
}

export function runCalendarRefresh() {
  if (activeCalendarRefresh) return activeCalendarRefresh;

  calendarRefreshStatus = {
    state: 'running', startedAt: new Date().toISOString(), completedAt: null, result: null, error: null,
  };
  activeCalendarRefresh = Promise.all([syncBseCalendar(), syncYahooCalendar(), syncNseCalendar()])
    .then(([summary, yahoo, nse]) => {
      const result = { message: 'Corporate calendar sync completed', summary, yahoo, nse };
      calendarRefreshStatus = {
        ...calendarRefreshStatus, state: 'succeeded', completedAt: new Date().toISOString(), result, error: null,
      };
      return result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown calendar refresh error';
      calendarRefreshStatus = {
        ...calendarRefreshStatus, state: 'failed', completedAt: new Date().toISOString(), result: null, error: message,
      };
      throw error;
    })
    .finally(() => { activeCalendarRefresh = null; });
  return activeCalendarRefresh;
}

export function startCalendarRefresh() {
  const alreadyRunning = Boolean(activeCalendarRefresh);
  const task = runCalendarRefresh();
  void task.catch(() => undefined);
  return { started: !alreadyRunning, status: getCalendarRefreshStatus() };
}
