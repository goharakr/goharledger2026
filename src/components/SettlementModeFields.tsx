import type { Transaction, HistoricalProfit, SettlementMode } from '../types';
import { calculateHomeExpensesOwed, calculateShareDue, ShareRule } from '../utils/shareDue';
import { formatKES } from '../utils/format';

// A linked customer/supplier (e.g. Mohamedi Glass, linked to partner
// Abdulqadir) can be settled using what the shop owes that partner, or the
// party's other-role balance, instead of only real Cash/Mpesa/Paybill. This
// is the shared "extra sources" section every payment form plugs in when the
// selected party has a linked_partner_id.

export interface SettlementAmounts {
  home_expense_offset: string;
  share_offset: string;
  cross_balance_offset: string;
}

export const emptySettlementAmounts: SettlementAmounts = {
  home_expense_offset: '',
  share_offset: '',
  cross_balance_offset: '',
};

export interface SettlementAvailable {
  home_expense_offset: number;
  share_offset: number;
  cross_balance_offset: number;
}

export function computeSettlementAvailable(
  transactions: Transaction[] | null | undefined,
  shareRules: ShareRule[] | null | undefined,
  historicalProfit: HistoricalProfit[] | null | undefined,
  partnerId: string,
  crossAvailable: number
): SettlementAvailable {
  return {
    home_expense_offset: calculateHomeExpensesOwed(transactions, partnerId),
    share_offset: calculateShareDue(transactions, shareRules, historicalProfit, partnerId),
    cross_balance_offset: crossAvailable,
  };
}

export function settlementAmountsTotal(amounts: SettlementAmounts): number {
  return (parseFloat(amounts.home_expense_offset || '0') || 0)
    + (parseFloat(amounts.share_offset || '0') || 0)
    + (parseFloat(amounts.cross_balance_offset || '0') || 0);
}

const SOURCE_LABELS: Record<keyof SettlementAmounts, string> = {
  home_expense_offset: 'Home Expenses Owed',
  share_offset: 'Profit Share Not Taken',
  cross_balance_offset: "Mohamedi's Other Balance",
};

// Returns a human-readable warning for each source that would go negative,
// for the caller to show in a confirm() before saving. Empty array = safe.
export function findSettlementOverflows(amounts: SettlementAmounts, available: SettlementAvailable, crossLabel?: string): string[] {
  const warnings: string[] = [];
  (Object.keys(amounts) as (keyof SettlementAmounts)[]).forEach((key) => {
    const used = parseFloat(amounts[key] || '0') || 0;
    const have = available[key] || 0;
    if (used > have) {
      const label = key === 'cross_balance_offset' && crossLabel ? crossLabel : SOURCE_LABELS[key];
      const over = used - have;
      warnings.push(`${label} only has KES ${formatKES(have)} available - using KES ${formatKES(used)} will push it KES ${formatKES(over)} into negative (becomes a credit owed back).`);
    }
  });
  return warnings;
}

export const SETTLEMENT_MODE_KEYS: { key: keyof SettlementAmounts; mode: SettlementMode }[] = [
  { key: 'home_expense_offset', mode: 'home_expense_offset' },
  { key: 'share_offset', mode: 'share_offset' },
  { key: 'cross_balance_offset', mode: 'cross_balance_offset' },
];

interface Props {
  partnerLabel: string;
  crossLabel: string; // e.g. "Mohamedi's Customer Balance" or "Mohamedi's Supplier Balance"
  available: SettlementAvailable;
  amounts: SettlementAmounts;
  onChange: (next: SettlementAmounts) => void;
}

export default function SettlementModeFields({ partnerLabel, crossLabel, available, amounts, onChange }: Props) {
  return (
    <div className="space-y-2 border border-amber-200 bg-amber-50 rounded p-2">
      <p className="text-xs font-medium text-amber-800">Settle using {partnerLabel}'s balances (optional, can combine with cash below)</p>
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-slate-600">
          Home Expenses Owed <span className="text-slate-400">(KES {formatKES(available.home_expense_offset)} available)</span>
          <input
            type="number"
            value={amounts.home_expense_offset}
            onChange={(e) => onChange({ ...amounts, home_expense_offset: e.target.value })}
            placeholder="0"
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </label>
        <label className="text-xs text-slate-600">
          Profit Share Not Taken <span className="text-slate-400">(KES {formatKES(available.share_offset)} available)</span>
          <input
            type="number"
            value={amounts.share_offset}
            onChange={(e) => onChange({ ...amounts, share_offset: e.target.value })}
            placeholder="0"
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </label>
        <label className="text-xs text-slate-600">
          {crossLabel} <span className="text-slate-400">(KES {formatKES(available.cross_balance_offset)} available)</span>
          <input
            type="number"
            value={amounts.cross_balance_offset}
            onChange={(e) => onChange({ ...amounts, cross_balance_offset: e.target.value })}
            placeholder="0"
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </label>
      </div>
    </div>
  );
}
