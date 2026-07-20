import { supabase } from './supabase';
import { insertTransactionWithId } from './transactionId';

// A sale's commission is recorded as its own Expense (category "commission")
// instead of being baked into the sale's own profit - see saleProfit(). This
// keeps one commission expense per sale in sync with whatever the sale's
// commission/commissionMode currently are: creates it, updates its amount
// and mode, or removes it if the commission is cleared to 0.
export async function syncCommissionExpense(
  saleTxnId: string,
  date: string,
  commission: number,
  commissionMode: string,
  createdBy: string | null
): Promise<void> {
  const description = `Commission on sale ${saleTxnId}`;
  const { data: existing } = await supabase
    .from('transactions')
    .select('*')
    .eq('type', 'expense')
    .eq('category', 'commission')
    .eq('description', description)
    .eq('is_void', false)
    .maybeSingle();

  if (commission > 0) {
    if (existing) {
      await supabase.from('transactions').update({
        date,
        amount: commission,
        primary_mode: commissionMode,
      }).eq('id', existing.id);
    } else {
      await insertTransactionWithId('CME-' + date.replace(/-/g, ''), (transactionId) => ({
        transaction_id: transactionId,
        date,
        type: 'expense',
        primary_mode: commissionMode,
        amount: commission,
        category: 'commission',
        description,
        created_by: createdBy,
      }));
    }
  } else if (existing) {
    await supabase.from('transactions').update({ is_void: true, void_reason: 'Commission removed from sale' }).eq('id', existing.id);
  }
}

// Voids a sale's linked commission expense, if any - called when the sale
// itself is voided/deleted, so the commission expense doesn't outlive it.
export async function voidCommissionExpense(saleTxnId: string, reason: string): Promise<void> {
  const description = `Commission on sale ${saleTxnId}`;
  const { data: existing } = await supabase
    .from('transactions')
    .select('*')
    .eq('type', 'expense')
    .eq('category', 'commission')
    .eq('description', description)
    .eq('is_void', false)
    .maybeSingle();
  if (existing) {
    await supabase.from('transactions').update({ is_void: true, void_reason: reason }).eq('id', existing.id);
  }
}
