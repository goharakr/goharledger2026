import { supabase } from './supabase';

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
