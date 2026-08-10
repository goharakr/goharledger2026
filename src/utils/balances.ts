import { supabase } from './supabase';
import { insertTransactionWithId } from './transactionId';
import { voidCommissionExpense } from './commissionExpense';
import type { SettlementMode, Transaction } from '../types';

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

// Recomputes a supplier's balance from scratch from its own Invoice/Payment/
// supplier-mode-Sale transactions, instead of shifting the existing balance by
// a delta. Used after correcting an Opening Balance or Invoice amount, so a
// fixed typo can't leave the balance out of sync with what the ledger actually
// shows. NOT safe for a "Dual" (linked-partner) supplier - a cross-balance
// offset payment can move its balance without leaving an Invoice/Payment/Sale
// row on this supplier's own ledger, so a recompute here would silently drop
// that adjustment. Callers must keep using adjustSupplierBalance's delta
// approach for those instead.
export async function recomputeSupplierBalance(supplierId: string): Promise<boolean> {
  const { data: txns, error: selectError } = await supabase
    .from('transactions')
    .select('type, amount, primary_mode')
    .eq('supplier_id', supplierId)
    .eq('is_void', false);
  if (selectError) { console.error('recomputeSupplierBalance: lookup failed', selectError); return false; }

  let balance = 0;
  for (const t of txns || []) {
    if (t.type === 'supplier_invoice') balance += t.amount || 0;
    else if (t.type === 'supplier_payment') balance -= t.amount || 0;
    else if (t.type === 'sale' && t.primary_mode === 'supplier') balance -= t.amount || 0;
  }

  const { error } = await supabase.from('suppliers').update({ balance }).eq('id', supplierId);
  if (error) { console.error('recomputeSupplierBalance: update failed', error); return false; }
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

const CASH_SPLIT_MODES = ['cash', 'mpesa', 'paybill'];

// Edits a payment's amount while keeping any settlement-source splits (Home
// Expense/Share/cross-balance) untouched - the whole delta is absorbed by the
// cash/mpesa/paybill portion, since a correction is normally about the real
// money side, not the settlement decision already made. Refuses (returns
// ok: false) if the new amount would be less than what's already settled via
// those non-cash sources - there's no sane automatic fix for that; the caller
// should tell the user to void and re-enter instead.
export async function adjustPaymentAmount(
  txn: { id: string; transaction_id: string; primary_mode: string | null },
  newAmount: number,
  overrideMode?: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: splits, error: splitsError } = await supabase
    .from('transaction_splits')
    .select('id, mode, amount')
    .eq('transaction_id', txn.transaction_id);
  if (splitsError) return { ok: false, error: splitsError.message };

  const nonCashTotal = (splits || [])
    .filter((s) => !CASH_SPLIT_MODES.includes(s.mode))
    .reduce((sum, s) => sum + (s.amount || 0), 0);

  if (nonCashTotal > 0) {
    const newCashAmount = newAmount - nonCashTotal;
    if (newCashAmount < 0) {
      return {
        ok: false,
        error: `New amount is less than the KES ${nonCashTotal.toLocaleString()} already settled on this payment via Home Expense/Share/Mohamedi's balance. Void this payment and re-enter it instead.`,
      };
    }
    const cashSplit = (splits || []).find((s) => CASH_SPLIT_MODES.includes(s.mode));
    const newMode = overrideMode || cashSplit?.mode || txn.primary_mode || 'cash';
    if (cashSplit) {
      if (newCashAmount > 0) {
        await supabase.from('transaction_splits').update({ amount: newCashAmount, mode: newMode }).eq('id', cashSplit.id);
      } else {
        await supabase.from('transaction_splits').delete().eq('id', cashSplit.id);
      }
    } else if (newCashAmount > 0) {
      await supabase.from('transaction_splits').insert({ transaction_id: txn.transaction_id, mode: newMode, amount: newCashAmount });
    }
    const { error } = await supabase.from('transactions').update({
      amount: newAmount,
      primary_mode: newCashAmount > 0 ? newMode : null,
      edited_at: new Date().toISOString(),
    }).eq('id', txn.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from('transactions').update({
    amount: newAmount,
    ...(overrideMode ? { primary_mode: overrideMode } : {}),
    edited_at: new Date().toISOString(),
  }).eq('id', txn.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

// Voids a sale and reverses everything it did: the customer/supplier balance
// it moved, any linked "pay cost price to a supplier now" invoice+payment
// pair, and its commission expense - shared by every page that can void a
// sale (Sales page itself, and a customer's/supplier's own transaction list)
// so they can never drift apart on what a sale void is supposed to undo.
export async function voidSale(txn: Transaction, reason: string): Promise<{ ok: boolean; error?: string }> {
  if (txn.customer_id && (txn.primary_mode === 'credit' || txn.primary_mode === 'advance')) {
    if (txn.primary_mode === 'credit') {
      await adjustCustomerCredit(txn.customer_id, -(txn.amount || 0));
    } else {
      await adjustCustomerAdvance(txn.customer_id, txn.amount || 0);
    }
  }
  if (txn.supplier_id && txn.primary_mode === 'supplier') {
    await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
  }

  const { data: linked } = await supabase
    .from('transactions')
    .select('*')
    .in('type', ['supplier_invoice', 'supplier_payment'])
    .eq('is_void', false)
    .or(`description.eq.Cost price taken on sale ${txn.transaction_id},description.eq.Cost price paid on sale ${txn.transaction_id}`);
  if (linked && linked.length > 0) {
    for (const lt of linked) {
      if (lt.type === 'supplier_invoice' && lt.supplier_id) {
        await adjustSupplierBalance(lt.supplier_id, -(lt.amount || 0));
      } else if (lt.type === 'supplier_payment' && lt.supplier_id) {
        await adjustSupplierBalance(lt.supplier_id, lt.amount || 0);
        await undoSettlementForTransaction(lt.transaction_id, lt.supplier_id, null);
      }
    }
    const { error: linkedError } = await supabase
      .from('transactions')
      .update({ is_void: true, void_reason: reason })
      .in('id', linked.map((lt) => lt.id));
    if (linkedError) return { ok: false, error: 'Failed to void linked supplier records: ' + linkedError.message };
  }

  const { error } = await supabase.from('transactions').update({ is_void: true, void_reason: reason }).eq('id', txn.id);
  if (error) return { ok: false, error: 'Failed to void: ' + error.message };
  await voidCommissionExpense(txn.transaction_id, reason);
  return { ok: true };
}
