import { supabase } from './supabase';
import { insertTransactionWithId } from './transactionId';
import type { Transaction } from '../types';

// Loan/advance balances are derived live from the transactions table, not
// stored on their own row - the same lesson this app already learned with
// stored balance columns silently drifting out of sync with the real
// ledger (see balances.ts). An `employee_loan`/`employee_advance` row is the
// money actually being given; every `employee_salary` row that references it
// via employee_loan_ref/employee_advance_ref is a deduction against it.

export interface EmployeeLoanEntry {
  transactionId: string;
  date: string;
  amount: number;
  notes: string | null;
  deducted: number;
  remaining: number;
}

function buildLedger(
  transactions: Transaction[] | null | undefined,
  employeeId: string,
  givenType: 'employee_loan' | 'employee_advance',
  refField: 'employee_loan_ref' | 'employee_advance_ref',
  deductionField: 'employee_loan_deduction' | 'employee_advance_deduction'
): EmployeeLoanEntry[] {
  const entries: EmployeeLoanEntry[] = [];
  (transactions || []).forEach((t) => {
    if (t.is_void || t.employee_id !== employeeId || t.type !== givenType) return;
    entries.push({ transactionId: t.transaction_id, date: t.date, amount: t.amount, notes: t.notes, deducted: 0, remaining: t.amount });
  });
  (transactions || []).forEach((t) => {
    if (t.is_void) return;
    const ref = t[refField];
    const amt = t[deductionField];
    if (!ref || !amt) return;
    const entry = entries.find((e) => e.transactionId === ref);
    if (entry) {
      entry.deducted += amt;
      entry.remaining -= amt;
    }
  });
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function calculateEmployeeLoans(transactions: Transaction[] | null | undefined, employeeId: string): EmployeeLoanEntry[] {
  return buildLedger(transactions, employeeId, 'employee_loan', 'employee_loan_ref', 'employee_loan_deduction');
}

export function calculateEmployeeAdvances(transactions: Transaction[] | null | undefined, employeeId: string): EmployeeLoanEntry[] {
  return buildLedger(transactions, employeeId, 'employee_advance', 'employee_advance_ref', 'employee_advance_deduction');
}

export interface EmployeeTotals {
  totalSalaryPaid: number;
  totalCommissionPaid: number;
  totalLoanGiven: number;
  totalLoanOutstanding: number;
  totalAdvanceGiven: number;
  totalAdvanceOutstanding: number;
}

export function calculateEmployeeTotals(transactions: Transaction[] | null | undefined, employeeId: string): EmployeeTotals {
  let totalSalaryPaid = 0;
  let totalCommissionPaid = 0;
  (transactions || []).forEach((t) => {
    if (t.is_void || t.employee_id !== employeeId || t.type !== 'employee_salary') return;
    totalSalaryPaid += t.amount || 0;
    totalCommissionPaid += t.commission || 0;
  });
  const loans = calculateEmployeeLoans(transactions, employeeId);
  const advances = calculateEmployeeAdvances(transactions, employeeId);
  return {
    totalSalaryPaid,
    totalCommissionPaid,
    totalLoanGiven: loans.reduce((s, l) => s + l.amount, 0),
    totalLoanOutstanding: loans.reduce((s, l) => s + Math.max(0, l.remaining), 0),
    totalAdvanceGiven: advances.reduce((s, a) => s + a.amount, 0),
    totalAdvanceOutstanding: advances.reduce((s, a) => s + Math.max(0, a.remaining), 0),
  };
}

// Deducting against a loan/advance that has less outstanding than the typed
// deduction (or none at all) is treated as a brand new loan/advance given and
// fully settled on the same day - so typing an amount always works, even
// against a zero balance, and it still leaves a full record behind (a
// same-day "given" + "deducted" pair) instead of silently doing nothing.
async function resolveDeductionRef(
  type: 'employee_loan' | 'employee_advance',
  employeeId: string,
  date: string,
  deduction: number,
  outstanding: number,
  activeRef: string | null,
  createdBy: string | null
): Promise<{ ref: string; error?: string } | null> {
  if (deduction <= 0) return null;
  if (activeRef && deduction <= outstanding) return { ref: activeRef };

  const prefix = (type === 'employee_loan' ? 'ELN-' : 'EAD-') + date.replace(/-/g, '');
  const { data, error, transactionId } = await insertTransactionWithId(prefix, (txnId) => ({
    transaction_id: txnId,
    date,
    type,
    primary_mode: null,
    amount: deduction,
    employee_id: employeeId,
    description: type === 'employee_loan' ? 'Loan given (settled same day)' : 'Advance given (settled same day)',
    created_by: createdBy,
  }));
  if (error || !data) return { ref: '', error: `Failed to record the ${type === 'employee_loan' ? 'loan' : 'advance'}: ${error?.message || 'unknown error'}` };
  return { ref: transactionId };
}

export interface SalaryPaymentInput {
  employeeId: string;
  date: string;
  salaryAmount: number;
  commission: number;
  loanDeduction: number;
  loanOutstanding: number;
  loanActiveRef: string | null;
  advanceDeduction: number;
  advanceOutstanding: number;
  advanceActiveRef: string | null;
  daysWorked: number | null;
  mode: string;
  notes: string | null;
  createdBy: string | null;
}

export async function saveEmployeeSalaryPayment(input: SalaryPaymentInput): Promise<{ ok: boolean; error?: string }> {
  const netAmount = input.salaryAmount + input.commission - input.loanDeduction - input.advanceDeduction;
  if (netAmount < 0) {
    return { ok: false, error: 'The loan and advance deductions add up to more than the salary and commission - the net amount would be negative.' };
  }

  let loanRef: string | null = null;
  if (input.loanDeduction > 0) {
    const resolved = await resolveDeductionRef('employee_loan', input.employeeId, input.date, input.loanDeduction, input.loanOutstanding, input.loanActiveRef, input.createdBy);
    if (resolved?.error) return { ok: false, error: resolved.error };
    loanRef = resolved?.ref || null;
  }

  let advanceRef: string | null = null;
  if (input.advanceDeduction > 0) {
    const resolved = await resolveDeductionRef('employee_advance', input.employeeId, input.date, input.advanceDeduction, input.advanceOutstanding, input.advanceActiveRef, input.createdBy);
    if (resolved?.error) return { ok: false, error: resolved.error };
    advanceRef = resolved?.ref || null;
  }

  const { error } = await insertTransactionWithId('SAL-' + input.date.replace(/-/g, ''), (txnId) => ({
    transaction_id: txnId,
    date: input.date,
    type: 'employee_salary',
    primary_mode: netAmount > 0 ? input.mode : null,
    amount: netAmount,
    employee_id: input.employeeId,
    commission: input.commission > 0 ? input.commission : null,
    commission_mode: input.commission > 0 ? input.mode : null,
    employee_loan_ref: loanRef,
    employee_loan_deduction: input.loanDeduction > 0 ? input.loanDeduction : null,
    employee_advance_ref: advanceRef,
    employee_advance_deduction: input.advanceDeduction > 0 ? input.advanceDeduction : null,
    days_worked: input.daysWorked,
    description: 'Salary payment',
    notes: input.notes,
    created_by: input.createdBy,
  }));
  if (error) return { ok: false, error: 'Failed to save salary payment: ' + error.message };
  return { ok: true };
}

// Same rules as saveEmployeeSalaryPayment, but updates an existing row in
// place instead of inserting a new one - used when editing a payment that
// was already saved (single or as part of a bulk run). loanOutstanding/
// advanceOutstanding must be computed with this transaction's own old
// deduction excluded first, or increasing a deduction here would look like
// it exceeds what's outstanding when it doesn't.
export async function updateEmployeeSalaryPayment(id: string, input: SalaryPaymentInput): Promise<{ ok: boolean; error?: string }> {
  const netAmount = input.salaryAmount + input.commission - input.loanDeduction - input.advanceDeduction;
  if (netAmount < 0) {
    return { ok: false, error: 'The loan and advance deductions add up to more than the salary and commission - the net amount would be negative.' };
  }

  let loanRef: string | null = null;
  if (input.loanDeduction > 0) {
    const resolved = await resolveDeductionRef('employee_loan', input.employeeId, input.date, input.loanDeduction, input.loanOutstanding, input.loanActiveRef, input.createdBy);
    if (resolved?.error) return { ok: false, error: resolved.error };
    loanRef = resolved?.ref || null;
  }

  let advanceRef: string | null = null;
  if (input.advanceDeduction > 0) {
    const resolved = await resolveDeductionRef('employee_advance', input.employeeId, input.date, input.advanceDeduction, input.advanceOutstanding, input.advanceActiveRef, input.createdBy);
    if (resolved?.error) return { ok: false, error: resolved.error };
    advanceRef = resolved?.ref || null;
  }

  const { error } = await supabase.from('transactions').update({
    date: input.date,
    primary_mode: netAmount > 0 ? input.mode : null,
    amount: netAmount,
    commission: input.commission > 0 ? input.commission : null,
    commission_mode: input.commission > 0 ? input.mode : null,
    employee_loan_ref: loanRef,
    employee_loan_deduction: input.loanDeduction > 0 ? input.loanDeduction : null,
    employee_advance_ref: advanceRef,
    employee_advance_deduction: input.advanceDeduction > 0 ? input.advanceDeduction : null,
    days_worked: input.daysWorked,
    notes: input.notes,
    edited_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return { ok: false, error: 'Failed to update salary payment: ' + error.message };
  return { ok: true };
}

// noRealCash: the money already left before this was recorded (e.g. a loan
// given back in July, entered into the app only now) - primary_mode is left
// null so walletBalance.ts's mode-based deduction never fires for it, same
// trick Capital's "No real cash" checkbox uses for historical entries.
export async function giveEmployeeLoan(employeeId: string, date: string, amount: number, mode: string, notes: string | null, createdBy: string | null, noRealCash?: boolean) {
  return insertTransactionWithId('ELN-' + date.replace(/-/g, ''), (txnId) => ({
    transaction_id: txnId,
    date,
    type: 'employee_loan',
    primary_mode: noRealCash ? null : mode,
    amount,
    employee_id: employeeId,
    description: noRealCash ? 'Loan given (already happened - not deducted from wallet)' : 'Loan given',
    notes,
    created_by: createdBy,
  }));
}

export async function giveEmployeeAdvance(employeeId: string, date: string, amount: number, mode: string, notes: string | null, createdBy: string | null, noRealCash?: boolean) {
  return insertTransactionWithId('EAD-' + date.replace(/-/g, ''), (txnId) => ({
    transaction_id: txnId,
    date,
    type: 'employee_advance',
    primary_mode: noRealCash ? null : mode,
    amount,
    employee_id: employeeId,
    description: noRealCash ? 'Advance given (already happened - not deducted from wallet)' : 'Advance given',
    notes,
    created_by: createdBy,
  }));
}

// Voiding/editing an employee_salary/employee_loan/employee_advance row never
// needs a separate balance-reversal call the way supplier/customer/loan
// balances do - every figure here (loan/advance remaining, totals) is
// derived live from non-void transactions, so simply changing is_void or the
// row's own fields is already the whole fix.
export async function voidEmployeeTransaction(id: string, reason?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('transactions').update({ is_void: true, void_reason: reason || null }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// The Salary form's Amount box auto-fills from this - Week/Month use the
// employee's own rate directly, Custom days is scaled off the weekly rate
// (weekly / 7 per day) since a daily rate isn't stored separately.
export function autoFillSalaryAmount(
  period: 'week' | 'month' | 'custom',
  customDays: string,
  weeklySalary: number | null,
  monthlySalary: number | null
): number {
  if (period === 'week') return weeklySalary || 0;
  if (period === 'month') return monthlySalary || 0;
  const days = parseFloat(customDays || '0') || 0;
  return ((weeklySalary || 0) / 7) * days;
}
