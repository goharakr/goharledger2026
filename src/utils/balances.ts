import { supabase } from './supabase';
import { insertTransactionWithId } from './transactionId';
import type { SettlementMode } from '../types';

// These always re-read the current value from the database right before
// writing, instead of trusting a possibly-stale value already held in
// component state. This avoids lost updates when two balance changes for
// the same record happen in close succession (e.g. two invoices added
// back-to-back before the screen has refreshed).

// Suppliers/customers balances are allowed to go negative on purpose: a negative
// supplier balance means the supplier owes the shop (e.g. a supplier-mode sale
// recorded before any invoice existed to offset it against), and a negative
// customer credit/advance balance means the shop owes the customer. Flooring at
// zero used to silently discard that credit instead of letting it carry forward
// and net out against the next invoice/sale - callers that display these values
// should style a negative balance as a credit, not just a bare negative number.
export async function adjustSupplierBalance(supplierId: string, delta: number): Promise<boolean> {
  const { data, error: selectError } = await supabase.from('suppliers').select('balance').eq('id', supplierId).single();
  if (selectError) { console.error('adjustSupplierBalance: could not read current balance', selectError); return false; }
  const next = (data?.balance || 0) + delta;
  const { error } = await supabase.from('suppliers').update({ balance: next }).eq('id', supplierId);
  if (error) { console.error('adjustSupplierBalance: update failed', error); return false; }
  return true;
}

export async function adjustCustomerCredit(customerId: string, delta: number): Promise<boolean> {
  const { data, error: selectError } = await supabase.from('customers').select('credit_balance').eq('id', customerId).single();
  if (selectError) { console.error('adjustCustomerCredit: could not read current balance', selectError); return false; }
  const next = (data?.credit_balance || 0) + delta;
  const { error } = await supabase.from('customers').update({ credit_balance: next }).eq('id', customerId);
  if (error) { console.error('adjustCustomerCredit: update failed', error); return false; }
  return true;
}

export async function adjustCustomerAdvance(customerId: string, delta: number): Promise<boolean> {
  const { data, error: selectError } = await supabase.from('customers').select('advance_balance').eq('id', customerId).single();
  if (selectError) { console.error('adjustCustomerAdvance: could not read current balance', selectError); return false; }
  const next = (data?.advance_balance || 0) + delta;
  const { error } = await supabase.from('customers').update({ advance_balance: next }).eq('id', customerId);
  if (error) { console.error('adjustCustomerAdvance: update failed', error); return false; }
  return true;
}

// positive paymentDelta = a payment was made (remaining down, paid up)
// negative paymentDelta = reversing a payment (remaining up, paid down)
//
// remaining_balance is allowed to go negative on purpose: a payment bigger
// than what was left overpays the loan, and the negative amount is the
// credit the loan is now ahead by, instead of silently discarding it.
export async function adjustLoanBalance(loanId: string, paymentDelta: number): Promise<boolean> {
  const { data, error: selectError } = await supabase.from('loan_trackers').select('remaining_balance, amount_paid').eq('id', loanId).single();
  if (selectError) { console.error('adjustLoanBalance: could not read current balance', selectError); return false; }
  const newBal = (data?.remaining_balance || 0) - paymentDelta;
  const newPaid = Math.max(0, (data?.amount_paid || 0) + paymentDelta);
  const { error } = await supabase.from('loan_trackers').update({
    remaining_balance: newBal,
    amount_paid: newPaid,
    status: newBal <= 0 ? 'settled' : 'active',
  }).eq('id', loanId);
  if (error) { console.error('adjustLoanBalance: update failed', error); return false; }
  return true;
}

// --- Linked-partner settlement (e.g. Mohamedi Glass <-> Abdulqadir) ---
//
// A customer/supplier record can be linked to a partner (linked_partner_id).
// When paying/collecting a linked party's balance, the amount can come from
// (in addition to real Cash/Mpesa/Paybill): what the shop owes that partner
// in unpaid Home Expenses, unpaid Profit Share, or the linked party's OTHER
// balance (their supplier bill netted against their customer debt, or vice
// versa) - no real cash moves for these.
//
// The caller (whichever page is recording the payment) is still responsible
// for adjusting the linked party's OWN balance (adjustSupplierBalance /
// adjustCustomerCredit) by the full amount paid, exactly as it already does
// for a plain cash payment - these helpers only record the OTHER side of a
// non-cash source: the partner-owed pool it came out of, or the party's
// other-role balance it was netted against.

export interface SettlementContext {
  partnerId: string; // the partner linked to the party being paid (e.g. 'abdulqadir')
  date: string;
  createdBy: string | null;
  refLabel: string; // e.g. the supplier/customer's display name, for the audit trail
  primaryTransactionId: string; // the supplier_payment/customer_payment this source belongs to
  // The OTHER record for the same real-world party - the customer_id when
  // paying them as a supplier, or the supplier_id when collecting from them
  // as a customer. Required only for the 'cross_balance_offset' source.
  crossPartyId?: string | null;
  crossPartyRole?: 'supplier' | 'customer';
}

// Records the non-cash side of one settlement source. Home Expense/Share
// offsets are recorded as their own real transaction (so Partners.tsx's
// existing Home Expenses Owed / Share Due totals pick them up automatically),
// tagged with "ref:<primaryTransactionId>" in its notes so
// undoSettlementForTransaction can find and void it later. Returns false (and
// leaves everything else untouched) if it can't be recorded - the caller
// should treat that as a failed save, same as any other write error.
export async function applySettlementSource(mode: SettlementMode, amount: number, ctx: SettlementContext): Promise<boolean> {
  if (!amount || amount <= 0) return true;

  if (mode === 'home_expense_offset') {
    const { error } = await insertTransactionWithId('HEO-' + ctx.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: ctx.date,
      type: 'expense',
      category: 'home_expense',
      primary_mode: null,
      amount,
      partner_id: ctx.partnerId,
      description: `Home expense settled via ${ctx.refLabel}`,
      notes: `From Shop | repaying | Settled via ${ctx.refLabel} | ref:${ctx.primaryTransactionId}`,
      created_by: ctx.createdBy,
    }));
    if (error) console.error('applySettlementSource(home_expense_offset) failed', error);
    return !error;
  }

  if (mode === 'share_offset') {
    const { error } = await insertTransactionWithId('PSO-' + ctx.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: ctx.date,
      type: 'partner_draw',
      primary_mode: null,
      amount,
      partner_id: ctx.partnerId,
      description: `Profit share taken - ${ctx.partnerId} (settled via ${ctx.refLabel})`,
      notes: `Settled via ${ctx.refLabel} | ref:${ctx.primaryTransactionId}`,
      created_by: ctx.createdBy,
    }));
    if (error) console.error('applySettlementSource(share_offset) failed', error);
    return !error;
  }

  if (mode === 'cross_balance_offset') {
    if (!ctx.crossPartyId || !ctx.crossPartyRole) return false;
    // ctx.crossPartyRole is the role of the party's OTHER record - e.g. when
    // paying them as a supplier, the cross party is their customer record.
    // The amount itself is recorded via the transaction_splits row the caller
    // already saves against primaryTransactionId (mode: cross_balance_offset)
    // - that's what undoSettlementForTransaction reads to reverse this later.
    return ctx.crossPartyRole === 'customer'
      ? adjustCustomerCredit(ctx.crossPartyId, -amount)
      : adjustSupplierBalance(ctx.crossPartyId, -amount);
  }

  return false;
}

// Undoes everything applySettlementSource(...) recorded for one primary
// transaction (used when that transaction is edited or voided). Voids the
// Home Expense/Share side-transactions it tagged with this ref, and reverses
// any cross-balance-offset amount by re-deriving the linked party's other
// record from linked_partner_id (nothing else remembers that link at void
// time, so it can't just be passed back in).
export async function undoSettlementForTransaction(
  primaryTransactionId: string,
  primarySupplierId?: string | null,
  primaryCustomerId?: string | null
): Promise<boolean> {
  const { data: sideTxns, error: findError } = await supabase
    .from('transactions')
    .select('id')
    .ilike('notes', `%ref:${primaryTransactionId}%`)
    .eq('is_void', false);
  if (findError) { console.error('undoSettlementForTransaction: lookup failed', findError); return false; }
  for (const t of sideTxns || []) {
    const { error } = await supabase.from('transactions').update({ is_void: true }).eq('id', t.id);
    if (error) { console.error('undoSettlementForTransaction: void failed', error); return false; }
  }

  const { data: splits, error: splitsError } = await supabase
    .from('transaction_splits')
    .select('amount')
    .eq('transaction_id', primaryTransactionId)
    .eq('mode', 'cross_balance_offset');
  if (splitsError) { console.error('undoSettlementForTransaction: split lookup failed', splitsError); return false; }
  const crossAmount = (splits || []).reduce((s, r) => s + (r.amount || 0), 0);
  if (crossAmount > 0) {
    if (primarySupplierId) {
      const { data: supp } = await supabase.from('suppliers').select('linked_partner_id').eq('id', primarySupplierId).single();
      if (supp?.linked_partner_id) {
        const { data: cust } = await supabase.from('customers').select('id').eq('linked_partner_id', supp.linked_partner_id).eq('is_active', true).maybeSingle();
        if (cust) await adjustCustomerCredit(cust.id, crossAmount);
      }
    } else if (primaryCustomerId) {
      const { data: cust } = await supabase.from('customers').select('linked_partner_id').eq('id', primaryCustomerId).single();
      if (cust?.linked_partner_id) {
        const { data: supp } = await supabase.from('suppliers').select('id').eq('linked_partner_id', cust.linked_partner_id).eq('is_active', true).maybeSingle();
        if (supp) await adjustSupplierBalance(supp.id, crossAmount);
      }
    }
  }
  return true;
}
