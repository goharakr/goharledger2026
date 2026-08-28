import { todayStr } from './format';
import type { Transaction } from '../types';

export interface LedgerEntry {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

// Builds a running-balance ledger (Date/Description/Debit/Credit/Balance) across every
// wallet-affecting transaction type, either for one payment mode or "all" combined.
// Shared by the Cash & Bank page and the Reports "Combined Ledger" so both show the exact
// same numbers, computed the exact same way. Entries come back in chronological order with
// each row's running balance already correct - callers filter by date and reverse for display.
export function buildLedgerEntries(
  transactions: Transaction[],
  splitMap: Map<string, { mode: string; amount: number }[]>,
  mode: string
): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  let balance = 0;
  const today = todayStr();

  const sorted = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  sorted.forEach((t) => {
    let debit = 0, credit = 0;

    if (t.type === 'sale') {
      if (mode === 'all') {
        if (t.primary_mode === 'mpesa') credit += t.amount;
        else if (t.primary_mode === 'cash') credit += t.amount;
        else if (t.primary_mode === 'paybill') credit += t.amount;
        else if (t.primary_mode === 'split') {
          const s = splitMap.get(t.transaction_id) || [];
          s.forEach((sp) => credit += sp.amount);
        }
        // Commission is its own Expense transaction (category "commission"),
        // handled by the 'expense' branch below - not deducted here.
      } else if (t.primary_mode === mode) {
        credit += t.amount;
      } else if (t.primary_mode === 'split') {
        const s = splitMap.get(t.transaction_id) || [];
        const sp = s.find((x) => x.mode === mode);
        if (sp) credit += sp.amount;
      }
    } else if (t.type === 'expense') {
      const isHomeExpenseFromOwnPocket = t.category === 'home_expense' && t.notes?.includes('From Own Pocket');
      const isPendingClear = t.clears_on && t.clears_on > today;
      if (!isHomeExpenseFromOwnPocket && !isPendingClear) {
        if (mode === 'all') {
          if (t.primary_mode === 'mpesa') debit += t.amount;
          else if (t.primary_mode === 'cash') debit += t.amount;
          else if (t.primary_mode === 'paybill') debit += t.amount;
        } else if (t.primary_mode === mode) {
          debit += t.amount;
        }
      }
    } else if (t.type === 'customer_payment') {
      if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
    } else if (t.type === 'opening_balance') {
      if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
    } else if (t.type === 'supplier_payment') {
      if (!(t.clears_on && t.clears_on > today) && (mode === 'all' || t.primary_mode === mode)) debit += t.amount;
    } else if (t.type === 'partner_draw') {
      if (mode === 'all' || t.primary_mode === mode) debit += t.amount;
    } else if (t.type === 'partner_loan') {
      if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
    } else if (t.type === 'loan_payment') {
      if (mode === 'all' || t.primary_mode === mode) debit += t.amount;
    } else if (t.type === 'capital_entry' && t.primary_mode) {
      // Unlike opening_balance/customer_payment, a capital entry can
      // legitimately have no wallet mode (e.g. Retained Profit isn't real
      // new cash), so it must not be counted in the "All" total either.
      if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
    } else if (t.type === 'fund_transfer') {
      // A transfer between your own wallets doesn't change your total money -
      // it only matters to the single wallet's own ledger (below), not "All".
      if (mode !== 'all') {
        const desc = (t.description || '').toLowerCase();
        if (desc.includes(`${mode} to`)) debit += t.amount;
        else if (desc.includes(`to ${mode}`)) credit += t.amount;
      }
    }

    if (debit > 0 || credit > 0) {
      balance += credit - debit;
      entries.push({ date: t.date, description: t.description || t.transaction_id, debit, credit, balance });
    }
  });

  return entries;
}
