import { DATE_PRESET_OPTIONS, DatePreset } from '../utils/dateFilters';

interface DateFilterBarProps {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onChange: (preset: DatePreset, customFrom: string, customTo: string) => void;
}

// Standard date filter used across the app: Today / Yesterday / 1 Week /
// 1 Month / Last Month / 3 Months / This Year / Custom.
export default function DateFilterBar({ preset, customFrom, customTo, onChange }: DateFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {DATE_PRESET_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value, customFrom, customTo)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            preset === opt.value ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
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
