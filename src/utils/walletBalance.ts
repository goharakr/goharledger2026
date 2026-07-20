import type { Transaction } from '../types';
import { localDateStr } from './format';

export interface WalletBalance {
  mpesa: number;
  cash: number;
  bank: number;
  mpesaAdvance: number;
  cashAdvance: number;
  bankAdvance: number;
}

// The single source of truth for Mpesa/Cash/Paybill wallet balances.
// Previously every page (Dashboard, CashBank) kept its own separate copy of
// this exact logic, and small differences between the copies caused real
// bugs (e.g. supplier payments silently excluded from the balance in some
// copies but not others). Every page must call this instead of re-deriving
// its own version.
//
// asOfDate is the EXCLUSIVE cutoff: only transactions dated strictly before
// it are counted, and a post-dated cheque (clears_on) that hasn't cleared by
// that date is skipped too. Pass tomorrowStr() for "the current, live
// balance" (includes today), or a month's first day for "the balance
// carried in as of the start of that month" (the Forwarded Balance calc).
export function computeWalletBalance(
  transactions: Transaction[] | null | undefined,
  splitMap: Map<string, { mode: string; amount: number }[]>,
  asOfDate: string
): WalletBalance {
  let mpesa = 0, cash = 0, bank = 0;
  let mpesaAdvance = 0, cashAdvance = 0, bankAdvance = 0;

  transactions?.forEach((t) => {
    if (t.is_void || t.date >= asOfDate) return;

    if (t.type === 'sale') {
      if (t.primary_mode === 'mpesa') mpesa += t.amount;
      else if (t.primary_mode === 'cash') cash += t.amount;
      else if (t.primary_mode === 'paybill') bank += t.amount;
      // 'advance' mode sales don't add anything here - that cash was already
      // counted when the advance was deposited (a customer_payment below), so
      // counting it again here would double it. It reduces the "held for
      // customers" sub-line instead, since it's no longer an outstanding advance.
      else if (t.primary_mode === 'advance') {
        if (t.settlement_mode === 'mpesa') mpesaAdvance -= t.amount;
        else if (t.settlement_mode === 'cash') cashAdvance -= t.amount;
        else if (t.settlement_mode === 'paybill') bankAdvance -= t.amount;
      }
      else if (t.primary_mode === 'split') {
        const s = splitMap.get(t.transaction_id) || [];
        s.forEach((sp) => {
          if (sp.mode === 'mpesa') mpesa += sp.amount;
          else if (sp.mode === 'cash') cash += sp.amount;
          else if (sp.mode === 'paybill') bank += sp.amount;
        });
      }
      // Sales to supplier - does NOT add to cash (it reduces supplier balance)
      // Commission is no longer deducted here - it's recorded as its own
      // Expense transaction (category "commission"), which is deducted
      // below under the 'expense' branch instead.
    } else if (t.type === 'expense') {
      const isHomeExpenseFromOwnPocket = t.category === 'home_expense' && t.notes?.includes('From Own Pocket');
      // A post-dated cheque hasn't left the bank yet - don't deduct it until
      // its "clears on" date actually arrives.
      const isPendingClear = t.clears_on && t.clears_on >= asOfDate;
      if (!isHomeExpenseFromOwnPocket && !isPendingClear) {
        if (t.primary_mode === 'mpesa') mpesa -= t.amount;
        else if (t.primary_mode === 'cash') cash -= t.amount;
        else if (t.primary_mode === 'paybill') bank -= t.amount;
      }
    } else if (t.type === 'fund_transfer') {
      const desc = (t.description || '').toLowerCase();
      if (desc.includes('mpesa to cash')) { mpesa -= t.amount; cash += t.amount; }
      else if (desc.includes('cash to mpesa')) { cash -= t.amount; mpesa += t.amount; }
      else if (desc.includes('mpesa to paybill')) { mpesa -= t.amount; bank += t.amount; }
      else if (desc.includes('paybill to mpesa')) { bank -= t.amount; mpesa += t.amount; }
      else if (desc.includes('cash to paybill')) { cash -= t.amount; bank += t.amount; }
      else if (desc.includes('paybill to cash')) { bank -= t.amount; cash += t.amount; }
    } else if (t.type === 'customer_payment') {
      // A deposit into a customer's advance balance is still cash held on
      // the shop's behalf that's technically owed back (as prepaid credit),
      // so it's tracked separately in the "advance" sub-line as well.
      const isAdvanceDeposit = t.description?.startsWith('Advance from') || t.transaction_id.startsWith('OPN-ADV-');
      if (t.primary_mode === 'mpesa') { mpesa += t.amount; if (isAdvanceDeposit) mpesaAdvance += t.amount; }
      else if (t.primary_mode === 'cash') { cash += t.amount; if (isAdvanceDeposit) cashAdvance += t.amount; }
      else if (t.primary_mode === 'paybill') { bank += t.amount; if (isAdvanceDeposit) bankAdvance += t.amount; }
    } else if (t.type === 'supplier_payment' || t.type === 'supplier_invoice') {
      // Supplier payments deduct from mode balance, unless it's a post-dated
      // cheque that hasn't cleared the bank yet.
      if (!(t.clears_on && t.clears_on >= asOfDate)) {
        if (t.primary_mode === 'mpesa') mpesa -= t.amount;
        else if (t.primary_mode === 'cash') cash -= t.amount;
        else if (t.primary_mode === 'paybill') bank -= t.amount;
      }
    } else if (t.type === 'partner_draw') {
      if (t.primary_mode === 'mpesa') mpesa -= t.amount;
      else if (t.primary_mode === 'cash') cash -= t.amount;
      else if (t.primary_mode === 'paybill') bank -= t.amount;
    } else if (t.type === 'partner_loan') {
      if (t.primary_mode === 'mpesa') mpesa += t.amount;
      else if (t.primary_mode === 'cash') cash += t.amount;
      else if (t.primary_mode === 'paybill') bank += t.amount;
    } else if (t.type === 'loan_payment') {
      if (t.primary_mode === 'mpesa') mpesa -= t.amount;
      else if (t.primary_mode === 'cash') cash -= t.amount;
      else if (t.primary_mode === 'paybill') bank -= t.amount;
    } else if (t.type === 'opening_balance') {
      if (t.primary_mode === 'mpesa') mpesa += t.amount;
      else if (t.primary_mode === 'cash') cash += t.amount;
      else if (t.primary_mode === 'paybill') bank += t.amount;
    } else if (t.type === 'capital_entry') {
      if (t.primary_mode === 'mpesa') mpesa += t.amount;
      else if (t.primary_mode === 'cash') cash += t.amount;
      else if (t.primary_mode === 'paybill') bank += t.amount;
    }
  });

  return { mpesa, cash, bank, mpesaAdvance, cashAdvance, bankAdvance };
}

// Tomorrow's date (YYYY-MM-DD) - pass as asOfDate to computeWalletBalance to
// get "the balance right now" (includes all of today, excludes nothing).
export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDateStr(d);
}
