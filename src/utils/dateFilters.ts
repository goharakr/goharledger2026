// Pure calendar-arithmetic date range presets - no Date.setDate()/setMonth()
// mutation, which shifts by the browser's local timezone offset (a bug this
// codebase has hit before).

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'pick_month' | 'custom';

export const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: '1 Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'pick_month', label: 'Pick Month' },
  { value: 'custom', label: 'Custom' },
];

function daysInMonth(year: number, month: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  let total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  return { year: y, month: m };
}

// For 'pick_month' the picked "YYYY-MM" is passed through customFrom - this
// keeps the (preset, customFrom, customTo) callback shape the same
// everywhere it's already wired up, no call site changes needed.
export function getDatePresetRange(preset: DatePreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const todayStr = `${y}-${pad(m)}-${pad(d)}`;

  switch (preset) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case 'yesterday': {
      let dd = d - 1, mm = m, yy = y;
      if (dd < 1) {
        const prev = addMonths(y, m, -1);
        mm = prev.month; yy = prev.year;
        dd = daysInMonth(yy, mm);
      }
      const s = `${yy}-${pad(mm)}-${pad(dd)}`;
      return { from: s, to: s };
    }
    case 'week': {
      let dd = d - 6, mm = m, yy = y;
      while (dd < 1) {
        const prev = addMonths(yy, mm, -1);
        yy = prev.year; mm = prev.month;
        dd += daysInMonth(yy, mm);
      }
      return { from: `${yy}-${pad(mm)}-${pad(dd)}`, to: todayStr };
    }
    case 'month':
      return { from: `${y}-${pad(m)}-01`, to: todayStr };
    case 'last_month': {
      const prev = addMonths(y, m, -1);
      const dim = daysInMonth(prev.year, prev.month);
      return { from: `${prev.year}-${pad(prev.month)}-01`, to: `${prev.year}-${pad(prev.month)}-${pad(dim)}` };
    }
    case 'pick_month': {
      const [py, pm] = (customFrom || `${y}-${pad(m)}`).split('-').map(Number);
      const dim = daysInMonth(py, pm);
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(dim)}` };
    }
    case 'custom':
      return { from: customFrom || todayStr, to: customTo || todayStr };
  }
}
