import { CalendarDays } from 'lucide-react';

export type DatePreset = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';
export type DateRangeValue = { preset: DatePreset; from: string; to: string };

export const ALL_DATE_RANGE: DateRangeValue = { preset: 'ALL', from: '', to: '' };

export const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const presetDateRange = (preset: Exclude<DatePreset, 'ALL' | 'CUSTOM'>, direction: 'past' | 'future' = 'past'): DateRangeValue => {
  const today = new Date();
  const from = new Date(today);
  const to = new Date(today);
  const target = direction === 'past' ? from : to;
  const sign = direction === 'past' ? -1 : 1;
  if (preset === 'WEEK') target.setDate(target.getDate() + sign * 6);
  if (preset === 'MONTH') target.setMonth(target.getMonth() + sign);
  if (preset === 'YEAR') target.setFullYear(target.getFullYear() + sign);
  return { preset, from: dateInputValue(from), to: dateInputValue(to) };
};

export const dateRangeParams = ({ from, to }: DateRangeValue) => ({
  ...(from ? { from } : {}),
  ...(to ? { to } : {}),
});

export function DateRangeFilter({ value, onChange, allowFuture = false, direction = 'past' }: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  allowFuture?: boolean;
  direction?: 'past' | 'future';
}) {
  const today = dateInputValue(new Date());
  return <div className="date-range-filter">
    <span><CalendarDays size={16}/>Date range</span>
    <div className="date-presets">
      <button type="button" className={value.preset === 'ALL' ? 'active' : ''} onClick={() => onChange(ALL_DATE_RANGE)}>All</button>
      {(['TODAY', 'WEEK', 'MONTH', 'YEAR'] as const).map((preset) => <button type="button" key={preset} className={value.preset === preset ? 'active' : ''} onClick={() => onChange(presetDateRange(preset, direction))}>{preset === 'TODAY' ? 'Today' : preset === 'WEEK' ? 'Week' : preset === 'MONTH' ? 'Month' : 'Year'}</button>)}
    </div>
    <label>From<input type="date" value={value.from} max={value.to || (allowFuture ? undefined : today)} onChange={(event) => onChange({ preset: 'CUSTOM', from: event.target.value, to: value.to })}/></label>
    <label>To<input type="date" value={value.to} min={value.from || undefined} max={allowFuture ? undefined : today} onChange={(event) => onChange({ preset: 'CUSTOM', from: value.from, to: event.target.value })}/></label>
  </div>;
}
