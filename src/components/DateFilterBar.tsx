import { DATE_PRESET_OPTIONS, DatePreset } from '../utils/dateFilters';

interface DateFilterBarProps {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onChange: (preset: DatePreset, customFrom: string, customTo: string) => void;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Standard date filter used across the app: a dropdown of Today / Yesterday /
// 1 Week / This Month / Last Month / Pick Month / Custom. "Pick Month" shows
// a Year + Month dropdown pair (a calendar-style jump to any month, instead
// of one long flat list of every month). "Custom" shows From/Till dates.
export default function DateFilterBar({ preset, customFrom, customTo, onChange }: DateFilterBarProps) {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let yr = currentYear - 5; yr <= currentYear + 1; yr++) years.push(yr);

  const [pickYearStr, pickMonthStr] = (customFrom || `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`).split('-');
  const pickYear = Number(pickYearStr);
  const pickMonth = Number(pickMonthStr);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={preset}
        onChange={(e) => {
          const next = e.target.value as DatePreset;
          if (next === 'pick_month' && !customFrom) {
            const now = new Date();
            onChange(next, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, customTo);
          } else {
            onChange(next, customFrom, customTo);
          }
        }}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
      >
        {DATE_PRESET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {preset === 'pick_month' && (
        <>
          <select
            value={pickMonth}
            onChange={(e) => onChange('pick_month', `${pickYear}-${e.target.value.padStart(2, '0')}`, customTo)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          >
            {MONTH_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
          </select>
          <select
            value={pickYear}
            onChange={(e) => onChange('pick_month', `${e.target.value}-${String(pickMonth).padStart(2, '0')}`, customTo)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          >
            {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
          </select>
        </>
      )}

      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onChange('custom', e.target.value, customTo)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onChange('custom', customFrom, e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
      )}
    </div>
  );
}
