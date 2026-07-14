import type { Transaction } from '../types';
import { saleProfit } from './format';

export interface MonthlyFigures {
  grossProfit: number;
  shopExpenses: number;
  homeExpensesFromShop: number;
  loanPayments: number;
}

export interface ShareRule {
  partner_id: string;
  rule_type: string;
  value: number;
}

// The single source of truth for "which months had real business activity,
// and what did they earn/spend" - used to work out each partner's Share Due.
// Previously Dashboard.tsx and Partners.tsx each kept their own separate copy
// of this exact logic, which is exactly the kind of duplication that caused
// real bugs (one copy fixed, the other left behind - see below).
//
// Only a month with a sale, a shop expense, a home-expense reimbursement, or
// a loan payment gets an entry - a month that only has something like a fund
// transfer or opening balance doesn't earn a share.
export function buildMonthlyFigures(transactions: Transaction[] | null | undefined): Map<string, MonthlyFigures> {
  const monthly = new Map<string, MonthlyFigures>();
  function touchMonth(key: string): MonthlyFigures {
    if (!monthly.has(key)) {
      monthly.set(key, { grossProfit: 0, shopExpenses: 0, homeExpensesFromShop: 0, loanPayments: 0 });
    }
    return monthly.get(key)!;
  }
  transactions?.forEach((t) => {
    if (t.is_void || !t.date) return;
    const key = t.date.slice(0, 7);
    if (t.type === 'sale') {
      touchMonth(key).grossProfit += saleProfit(t);
    } else if (t.type === 'expense' && t.category !== 'stock' && t.category !== 'supplier_payment') {
      if (t.category === 'home_expense') {
        if (t.notes?.includes('From Shop')) touchMonth(key).homeExpensesFromShop += t.amount;
      } else {
        touchMonth(key).shopExpenses += t.amount;
      }
    } else if (t.type === 'loan_payment') {
      touchMonth(key).loanPayments += t.amount;
    }
  });
  return monthly;
}

// Sums a partner's "earned" entitlement across every month with real
// activity, using their active Fixed/Percentage share rule.
export function calculateShareEarned(monthly: Map<string, MonthlyFigures>, rule: ShareRule | undefined): number {
  if (!rule) return 0;
  let earned = 0;
  monthly.forEach((m) => {
    const netProfit = m.grossProfit - m.shopExpenses - m.homeExpensesFromShop - m.loanPayments;
    earned += rule.rule_type === 'fixed' ? rule.value : netProfit * (rule.value / 100);
  });
  return earned;
}

// A month covered by a manually-entered Historical Profit record should not
// also have live transactions counted separately into Share Due - that would
// count the same month's profit twice. This doesn't fix it automatically; it
// just flags the overlap so it can be reviewed. Uses the same "real
// activity" months as calculateShareEarned, not every month with any
// transaction at all.
export function getDoubleCountedMonths(monthly: Map<string, MonthlyFigures>, historicalMonths: string[]): string[] {
  const histSet = new Set(historicalMonths);
  return Array.from(monthly.keys()).filter((m) => histSet.has(m)).sort();
}

// How much the shop currently owes a partner back for home expenses they
// paid out of their own pocket, net of any "From Shop (repaying)" reimbursement.
export function calculateHomeExpensesOwed(transactions: Transaction[] | null | undefined, partnerId: string): number {
  let owed = 0;
  transactions?.forEach((t) => {
    if (t.is_void || t.type !== 'expense' || t.category !== 'home_expense' || t.partner_id !== partnerId) return;
    if (t.notes?.includes('From Own Pocket')) owed += t.amount;
    if (t.notes?.includes('From Shop') && t.notes?.includes('repaying')) owed -= t.amount;
  });
  return owed;
}
