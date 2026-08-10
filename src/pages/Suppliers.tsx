import { useEffect, useState, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  X,
  Edit2,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, formatTime, todayStr, isSaleIncomplete } from '../utils/format';
import { adjustSupplierBalance, applySettlementSource, undoSettlementForTransaction, adjustPaymentAmount } from '../utils/balances';
import { insertTransactionWithId } from '../utils/transactionId';
import { fetchAllRows } from '../utils/fetchAll';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { usePersistentState } from '../context/PageStateContext';
import { handleFormKeyNav } from '../utils/formKeyNav';
import LedgerModal from '../components/LedgerModal';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import { sortSuppliersByBalance } from '../utils/sortEntities';
import SettlementModeFields, {
  emptySettlementAmounts,
  computeSettlementAvailable,
  settlementAmountsTotal,
  findSettlementOverflows,
  SETTLEMENT_MODE_KEYS,
  SettlementAmounts,
} from '../components/SettlementModeFields';
import type { ShareRule } from '../utils/shareDue';
import { useSaveGuard } from '../utils/useSaveGuard';
import type { Supplier, Transaction, Customer, HistoricalProfit } from '../types';

interface SupplierForm {
  name: string;
  phone: string;
  notes: string;
  isDualParty: boolean;
  openingBalance: string;
  linkedPartnerId: string;
}

interface InvoiceForm {
  date: string;
  dueDate: string;
  amount: string;
  notes: string;
  setReminder: boolean;
  reminderDate: string;
}

interface PaymentForm {
  amount: string;
  date: string;
  mode: string;
  notes: string;
  isPostDated: boolean;
  clearsOn: string;
  transactionFee: string;
  settlement: SettlementAmounts;
}

const emptySupplier: SupplierForm = {
  name: '',
  phone: '',
  notes: '',
  isDualParty: false,
  openingBalance: '',
  linkedPartnerId: '',
};

const emptyInvoice: InvoiceForm = {
  date: todayStr(),
  dueDate: '',
  amount: '',
  notes: '',
  setReminder: false,
  reminderDate: '',
};

const emptyPayment: PaymentForm = {
  amount: '',
  date: todayStr(),
  mode: 'cash',
  notes: '',
  isPostDated: false,
  clearsOn: '',
  transactionFee: '',
  settlement: emptySettlementAmounts,
};

interface BulkPaymentRow {
  supplierId: string;
  amount: string;
  date: string;
  mode: string;
  notes: string;
  isPostDated: boolean;
  clearsOn: string;
  transactionFee: string;
}

const emptyBulkPaymentRow: BulkPaymentRow = {
  supplierId: '',
  amount: '',
  date: todayStr(),
  mode: 'cash',
  notes: '',
  isPostDated: false,
  clearsOn: '',
  transactionFee: '',
};

export default function Suppliers() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shareRules, setShareRules] = useState<ShareRule[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [selectedSupplier, setSelectedSupplier] = usePersistentState<Supplier | null>('suppliers.selectedSupplier', null);
  const [loading, setLoading] = useState(true);
  const { saving: savingSupplier, guard: guardSupplier } = useSaveGuard();
  const { saving: savingInvoice, guard: guardInvoice } = useSaveGuard();
  const { saving: savingPayment, guard: guardPayment } = useSaveGuard();
  const [showAdd, setShowAdd] = usePersistentState('suppliers.showAdd', false);
  const [showInvoice, setShowInvoice] = usePersistentState('suppliers.showInvoice', false);
  const [showPayment, setShowPayment] = usePersistentState('suppliers.showPayment', false);
  const [form, setForm] = usePersistentState<SupplierForm>('suppliers.form', emptySupplier);
  const [invoiceForm, setInvoiceForm] = usePersistentState<InvoiceForm>('suppliers.invoiceForm', emptyInvoice);
  const [paymentForm, setPaymentForm] = usePersistentState<PaymentForm>('suppliers.paymentForm', emptyPayment);
  const [search, setSearch] = usePersistentState('suppliers.search', '');
  const [listSort, setListSort] = usePersistentState<'balance' | 'name'>('suppliers.listSort', 'balance');
  const [editingId, setEditingId] = usePersistentState<string | null>('suppliers.editingId', null);
  const [showLedger, setShowLedger] = useState(false);
  const [showBulkPayment, setShowBulkPayment] = usePersistentState('suppliers.showBulkPayment', false);
  const [bulkPaymentForms, setBulkPaymentForms] = usePersistentState<BulkPaymentRow[]>('suppliers.bulkPaymentForms', () => Array.from({ length: 10 }, () => ({ ...emptyBulkPaymentRow })));
  const [bulkPaymentSaving, setBulkPaymentSaving] = useState(false);
  const [txnDatePreset, setTxnDatePreset] = usePersistentState<DatePreset>('suppliers.txnDatePreset', 'month');
  const [txnCustomFrom, setTxnCustomFrom] = usePersistentState('suppliers.txnCustomFrom', '');
  const [txnCustomTo, setTxnCustomTo] = usePersistentState('suppliers.txnCustomTo', '');
  const [editingPaymentId, setEditingPaymentId] = usePersistentState<string | null>('suppliers.editingPaymentId', null);
  const [paymentEditForm, setPaymentEditForm] = usePersistentState('suppliers.paymentEditForm', { amount: '', date: '', mode: 'cash', notes: '' });
  const [netChecked, setNetChecked] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = usePersistentState<string | null>('suppliers.editingInvoiceId', null);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    const txn = transactions.find((t) => t.id === editId);
    if (!txn || !txn.supplier_id) return;
    const supp = suppliers.find((s) => s.id === txn.supplier_id);
    if (!supp) return;
    setSelectedSupplier(supp);
    setTxnDatePreset('all');
    if (txn.type === 'supplier_invoice') startEditInvoice(txn);
    else if (txn.type === 'supplier_payment') startEditPayment(txn);
    setSearchParams({}, { replace: true });
  }, [transactions, suppliers, searchParams]);

  useEffect(() => {
    if (selectedSupplier) {
      const updated = suppliers.find((s) => s.id === selectedSupplier.id);
      if (updated) setSelectedSupplier(updated);
    }
  }, [suppliers]);

  async function fetchData() {
    setLoading(true);
    const [{ data: supp }, { data: txns }, { data: custs }, { data: rules }, { data: hist }] = await Promise.all([
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }).range(from, to)
      ),
      supabase.from('customers').select('*').eq('is_active', true),
      supabase.from('share_rules').select('*').eq('is_active', true),
      supabase.from('historical_profit').select('*'),
    ]);
    setSuppliers(supp || []);
    setTransactions(txns || []);
    setCustomers(custs || []);
    setShareRules(rules || []);
    setHistoricalProfit(hist || []);
    setLoading(false);
    return { supp, txns };
  }

  async function refreshSupplierData() {
    const { supp } = await fetchData();
    if (selectedSupplier && supp) {
      const updated = supp.find((s) => s.id === selectedSupplier.id);
      if (updated) setSelectedSupplier(updated);
    }
    triggerRefresh();
  }

  function openingBalanceTxnId(supplierId: string) {
    return `OPN-BAL-${supplierId}`;
  }

  async function handleSaveSupplier() {
    const name = form.name.trim();
    if (!name) return;
    if (!editingId && suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      alert('A supplier with this name already exists.');
      return;
    }

    // Linking a supplier to a partner is easy to do by accident (the dropdown
    // is on every supplier's form) and has real consequences - it lets their
    // balance be settled using that partner's personal Home Expenses/Profit
    // Share, so confirm it explicitly, and flag if that partner is already
    // linked elsewhere (normally each partner should only have one).
    const currentLinkedPartnerId = editingId ? (suppliers.find((s) => s.id === editingId)?.linked_partner_id || '') : '';
    if (form.linkedPartnerId && form.linkedPartnerId !== currentLinkedPartnerId) {
      const partnerLabel = form.linkedPartnerId === 'abdulqadir' ? 'Abdulqadir' : 'Taher';
      if (!confirm(`Link "${name}" to ${partnerLabel}? This lets settling this supplier's balance use ${partnerLabel}'s personal Home Expenses Owed / Profit Share.`)) return;

      const otherLinked = suppliers.find((s) => s.linked_partner_id === form.linkedPartnerId && s.id !== editingId);
      if (otherLinked && !confirm(`${partnerLabel} is already linked to supplier "${otherLinked.name}". Linking "${name}" too means both share the same settlement pool - continue anyway?`)) return;
    }

    const newOpening = parseFloat(form.openingBalance || '0');

    if (editingId) {
      await supabase.from('suppliers').update({
        name: form.name.trim(),
        phone: form.phone || null,
        notes: form.notes || null,
        is_dual_party: form.isDualParty,
        linked_partner_id: form.linkedPartnerId || null,
      }).eq('id', editingId);

      // Keep the opening balance in sync by delta, not by overwriting the whole
      // balance - any real invoices/payments recorded since should not be wiped out.
      // Look up the mirror row directly (not from is_void-filtered state) so a
      // previously-voided row is found and revived instead of re-inserted, which
      // would fail against the transaction_id unique constraint.
      const txnId = openingBalanceTxnId(editingId);
      const { data: existing } = await supabase.from('transactions').select('*').eq('transaction_id', txnId).maybeSingle();
      const oldOpening = existing && !existing.is_void ? existing.amount || 0 : 0;
      const delta = newOpening - oldOpening;

      if (delta !== 0) {
        await adjustSupplierBalance(editingId, delta);
      }

      if (existing) {
        if (newOpening > 0) {
          await supabase.from('transactions').update({ amount: newOpening, is_void: false, edited_at: new Date().toISOString() }).eq('id', existing.id);
        } else if (!existing.is_void) {
          await supabase.from('transactions').update({ is_void: true, void_reason: 'Opening balance removed' }).eq('id', existing.id);
        }
      } else if (newOpening > 0) {
        await supabase.from('transactions').insert({
          transaction_id: txnId,
          date: todayStr(),
          type: 'supplier_invoice',
          primary_mode: null,
          amount: newOpening,
          supplier_id: editingId,
          description: `Opening balance - ${form.name.trim()}`,
          created_by: user?.username || null,
        });
      }
    } else {
      const { data: newSupplier } = await supabase.from('suppliers').insert({
        name: form.name.trim(),
        phone: form.phone || null,
        notes: form.notes || null,
        is_dual_party: form.isDualParty,
        linked_partner_id: form.linkedPartnerId || null,
        balance: newOpening,
      }).select().single();

      // Mirror a nonzero opening balance into transactions so it shows up in
      // Reports/the Ledger with a visible origin, and can be edited/deleted later
      if (newSupplier && newOpening > 0) {
        await supabase.from('transactions').insert({
          transaction_id: openingBalanceTxnId(newSupplier.id),
          date: todayStr(),
          type: 'supplier_invoice',
          primary_mode: null,
          amount: newOpening,
          supplier_id: newSupplier.id,
          description: `Opening balance - ${newSupplier.name}`,
          created_by: user?.username || null,
        });
      }
    }

    setForm(emptySupplier);
    setShowAdd(false);
    setEditingId(null);
    fetchData();
    triggerRefresh();
  }

  function startEditInvoice(t: Transaction) {
    setEditingInvoiceId(t.id);
    setInvoiceForm({
      date: t.date,
      dueDate: t.due_date || '',
      amount: String(t.amount || ''),
      notes: t.notes || '',
      setReminder: false,
      reminderDate: '',
    });
    setShowInvoice(true);
  }

  async function handleAddInvoice() {
    if (!selectedSupplier || !invoiceForm.amount || parseFloat(invoiceForm.amount) <= 0) return;

    const amt = parseFloat(invoiceForm.amount);

    if (editingInvoiceId) {
      const oldTxn = transactions.find((t) => t.id === editingInvoiceId);
      if (!oldTxn) return;
      const delta = amt - (oldTxn.amount || 0);
      const { error } = await supabase.from('transactions').update({
        date: invoiceForm.date,
        amount: amt,
        due_date: invoiceForm.dueDate || null,
        notes: invoiceForm.notes || null,
        edited_at: new Date().toISOString(),
      }).eq('id', editingInvoiceId);
      if (error) { alert('Failed to save invoice: ' + error.message); return; }
      if (delta !== 0) await adjustSupplierBalance(selectedSupplier.id, delta);
      setEditingInvoiceId(null);
      setInvoiceForm(emptyInvoice);
      setShowInvoice(false);
      refreshSupplierData();
      return;
    }

    // Create supplier_invoice transaction (NOT expense - separate from shop expenses)
    const { data: newTxn, error, transactionId: txnId } = await insertTransactionWithId('INV-' + invoiceForm.date.replace(/-/g, ''), (transactionId) => ({
      transaction_id: transactionId,
      date: invoiceForm.date,
      type: 'supplier_invoice',
      primary_mode: null,
      amount: amt,
      supplier_id: selectedSupplier.id,
      due_date: invoiceForm.dueDate || null,
      description: `Invoice from ${selectedSupplier.name}`,
      notes: invoiceForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save invoice: ' + (error?.message || 'unknown error')); return; }

    // Update supplier balance (re-reads the current balance first so two invoices added
    // back-to-back always add up instead of one overwriting the other)
    await adjustSupplierBalance(selectedSupplier.id, amt);

    // Create reminder if set
    if (invoiceForm.setReminder && invoiceForm.reminderDate) {
      await supabase.from('reminders').insert({
        reminder_type: 'supplier_payment',
        entity_id: selectedSupplier.id,
        entity_type: 'supplier',
        amount: amt,
        due_date: invoiceForm.dueDate || invoiceForm.date,
        reminder_date: invoiceForm.reminderDate,
        notes: `Invoice ${txnId} - ${selectedSupplier.name}`,
      });
    }

    setInvoiceForm(emptyInvoice);
    setShowInvoice(false);
    refreshSupplierData();
  }

  // Mpesa/Paybill payments often lose a small amount to a network/bank fee -
  // record that as its own separate expense so it shows up as real money out.
  async function insertTransactionFee(dateStr: string, mode: string, feeStr: string, relatedTo: string) {
    const fee = parseFloat(feeStr || '0');
    if (!fee || fee <= 0) return;
    if (mode !== 'mpesa' && mode !== 'paybill') return;
    await insertTransactionWithId('FEE-' + dateStr.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: dateStr,
      type: 'expense',
      category: 'transaction_fee',
      primary_mode: mode,
      amount: fee,
      description: `Transaction fee - ${relatedTo}`,
      created_by: user?.username || null,
    }));
  }

  function linkedCustomerFor(partnerId: string) {
    return customers.find((c) => c.linked_partner_id === partnerId);
  }

  async function handlePayment() {
    if (!selectedSupplier || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0) return;

    const amt = parseFloat(paymentForm.amount);
    const linkedPartnerId = selectedSupplier.linked_partner_id;
    const linkedCustomer = linkedPartnerId ? linkedCustomerFor(linkedPartnerId) : undefined;
    const settlementTotal = linkedPartnerId ? settlementAmountsTotal(paymentForm.settlement) : 0;
    const cashAmt = amt - settlementTotal;

    if (settlementTotal > amt) { alert('The settlement amounts add up to more than the total payment amount.'); return; }

    if (linkedPartnerId && settlementTotal > 0) {
      const available = computeSettlementAvailable(transactions, shareRules, historicalProfit, linkedPartnerId, linkedCustomer?.credit_balance || 0);
      const warnings = findSettlementOverflows(paymentForm.settlement, available, "Mohamedi's Customer Balance");
      if (warnings.length > 0 && !confirm(warnings.join('\n\n') + '\n\nContinue?')) return;
    }

    const { data: newTxn, error } = await insertTransactionWithId('SUP-' + paymentForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: paymentForm.date,
      type: 'supplier_payment',
      primary_mode: cashAmt > 0 ? (paymentForm.mode as any) : null,
      amount: amt,
      supplier_id: selectedSupplier.id,
      description: `Payment to ${selectedSupplier.name}`,
      notes: paymentForm.notes || null,
      clears_on: paymentForm.mode === 'paybill' && paymentForm.isPostDated && paymentForm.clearsOn ? paymentForm.clearsOn : null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save payment: ' + (error?.message || 'unknown error')); return; }

    await adjustSupplierBalance(selectedSupplier.id, -amt);

    const splitRows: { transaction_id: string; mode: string; amount: number }[] = [];
    if (cashAmt > 0) splitRows.push({ transaction_id: newTxn.transaction_id, mode: paymentForm.mode, amount: cashAmt });

    if (linkedPartnerId && settlementTotal > 0) {
      const ctx = {
        partnerId: linkedPartnerId,
        date: paymentForm.date,
        createdBy: user?.username || null,
        refLabel: selectedSupplier.name,
        primaryTransactionId: newTxn.transaction_id,
        crossPartyId: linkedCustomer?.id || null,
        crossPartyRole: 'customer' as const,
      };
      for (const { key, mode } of SETTLEMENT_MODE_KEYS) {
        const srcAmount = parseFloat(paymentForm.settlement[key] || '0') || 0;
        if (srcAmount > 0) {
          splitRows.push({ transaction_id: newTxn.transaction_id, mode, amount: srcAmount });
          await applySettlementSource(mode, srcAmount, ctx);
        }
      }
    }
    if (splitRows.length > 0) {
      await supabase.from('transaction_splits').insert(splitRows);
    }

    if (cashAmt > 0) await insertTransactionFee(paymentForm.date, paymentForm.mode, paymentForm.transactionFee, selectedSupplier.name);

    setPaymentForm(emptyPayment);
    setShowPayment(false);
    refreshSupplierData();
  }

  // One-click version of "Pay Supplier" for the netting banner - the whole
  // amount is settled via cross_balance_offset, no cash involved, so it's
  // just a supplier_payment transaction that's 100% settlement.
  async function handleNetCrossBalance(amount: number) {
    if (!selectedSupplier || !selectedSupplier.linked_partner_id) return;
    const linkedPartnerId = selectedSupplier.linked_partner_id;
    const linkedCustomer = linkedCustomerFor(linkedPartnerId);
    if (!linkedCustomer) return;

    const date = todayStr();
    const { data: newTxn, error } = await insertTransactionWithId('SUP-' + date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date,
      type: 'supplier_payment',
      primary_mode: null,
      amount,
      supplier_id: selectedSupplier.id,
      description: `Payment to ${selectedSupplier.name}`,
      notes: `Netted against ${selectedSupplier.name}'s customer balance`,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to net balances: ' + (error?.message || 'unknown error')); return; }

    await adjustSupplierBalance(selectedSupplier.id, -amount);
    await applySettlementSource('cross_balance_offset', amount, {
      partnerId: linkedPartnerId,
      date,
      createdBy: user?.username || null,
      refLabel: selectedSupplier.name,
      primaryTransactionId: newTxn.transaction_id,
      crossPartyId: linkedCustomer.id,
      crossPartyRole: 'customer',
    });
    await supabase.from('transaction_splits').insert({ transaction_id: newTxn.transaction_id, mode: 'cross_balance_offset', amount });

    setNetChecked(false);
    refreshSupplierData();
    triggerRefresh();
  }

  // Unlike "Pay Supplier" above (one payment, to the currently-selected
  // supplier), each row here picks its own supplier - for logging payments
  // to many different suppliers in one sitting, e.g. catching up on real data.
  async function handleBulkPaymentSave() {
    if (bulkPaymentSaving) return;
    const noSupplierRows: number[] = [];
    const validForms = bulkPaymentForms
      .map((f, originalIndex) => ({ f, originalIndex }))
      .filter(({ f, originalIndex }) => {
        if (!f.amount || parseFloat(f.amount) <= 0) return false;
        if (!f.supplierId) { noSupplierRows.push(originalIndex + 1); return false; }
        return true;
      });
    if (noSupplierRows.length > 0) {
      alert(`Row(s) ${noSupplierRows.join(', ')}: has an amount but no Supplier picked - these rows were NOT saved. Pick a supplier and save them again.`);
    }
    if (validForms.length === 0) return;
    setBulkPaymentSaving(true);
    try {
      const failedRows: number[] = [];

      for (let i = 0; i < validForms.length; i++) {
        const { f, originalIndex } = validForms[i];
        const amt = parseFloat(f.amount);
        const supplier = suppliers.find((s) => s.id === f.supplierId);
        if (!supplier) { failedRows.push(originalIndex + 1); continue; }

        const { data: newTxn, error } = await insertTransactionWithId('SUP-' + f.date.replace(/-/g, ''), (txnId) => ({
          transaction_id: txnId,
          date: f.date,
          type: 'supplier_payment',
          primary_mode: f.mode,
          amount: amt,
          supplier_id: f.supplierId,
          description: `Payment to ${supplier.name}`,
          notes: f.notes || null,
          clears_on: f.mode === 'paybill' && f.isPostDated && f.clearsOn ? f.clearsOn : null,
          created_by: user?.username || null,
        }));
        if (error || !newTxn) { console.error(error); failedRows.push(originalIndex + 1); continue; }
        await adjustSupplierBalance(f.supplierId, -amt);
        await insertTransactionFee(f.date, f.mode, f.transactionFee, supplier.name);
      }

      setBulkPaymentForms(Array.from({ length: 10 }, () => ({ ...emptyBulkPaymentRow, date: todayStr() })));
      setShowBulkPayment(false);
      refreshSupplierData();
      if (failedRows.length > 0) {
        alert(`Row(s) ${failedRows.join(', ')} failed to save and were skipped. The rest were saved successfully.`);
      }
    } finally {
      setBulkPaymentSaving(false);
    }
  }

  async function handleVoidTransaction(id: string) {
    const txn = transactions.find((t) => t.id === id);
    if (!txn) return;

    if (txn.supplier_id && txn.type === 'expense' && (txn.category === 'supplier_payment' || txn.category === 'stock')) {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
    }
    if (txn.supplier_id && txn.type === 'supplier_payment') {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
      await undoSettlementForTransaction(txn.transaction_id, txn.supplier_id, null);
    }
    if (txn.supplier_id && txn.type === 'supplier_invoice') {
      await adjustSupplierBalance(txn.supplier_id, -(txn.amount || 0));
    }
    if (txn.supplier_id && txn.type === 'sale' && txn.primary_mode === 'supplier') {
      await adjustSupplierBalance(txn.supplier_id, txn.selling_price ?? txn.amount ?? 0);
    }

    const { error } = await supabase.from('transactions').update({ is_void: true }).eq('id', id);
    if (error) { alert('Failed to void: ' + error.message); return; }
    fetchData();
    triggerRefresh();
  }

  function startEditPayment(t: Transaction) {
    setEditingPaymentId(t.id);
    setPaymentEditForm({ amount: String(t.amount || ''), date: t.date, mode: t.primary_mode || 'cash', notes: t.notes || '' });
  }

  async function handleUpdatePayment() {
    if (!editingPaymentId) return;
    const txn = transactions.find((t) => t.id === editingPaymentId);
    if (!txn || !txn.supplier_id) return;

    const newAmount = parseFloat(paymentEditForm.amount);
    if (!paymentEditForm.amount || isNaN(newAmount) || newAmount <= 0) {
      alert('Enter a valid amount greater than 0');
      return;
    }
    const delta = newAmount - (txn.amount || 0);

    const result = await adjustPaymentAmount(txn, newAmount, paymentEditForm.mode);
    if (!result.ok) { alert(result.error); return; }
    await supabase.from('transactions').update({ date: paymentEditForm.date, notes: paymentEditForm.notes || null }).eq('id', editingPaymentId);

    if (delta !== 0) await adjustSupplierBalance(txn.supplier_id, -delta);

    setEditingPaymentId(null);
    setPaymentEditForm({ amount: '', date: '', mode: 'cash', notes: '' });
    refreshSupplierData();
    triggerRefresh();
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    const opening = transactions.find((t) => t.transaction_id === openingBalanceTxnId(supplier.id));
    setForm({
      name: supplier.name,
      phone: supplier.phone || '',
      notes: supplier.notes || '',
      isDualParty: supplier.is_dual_party,
      openingBalance: String(opening?.amount || 0),
      linkedPartnerId: supplier.linked_partner_id || '',
    });
    setShowAdd(true);
  }

  function getSupplierTransactions(supplierId: string) {
    const { from, to } = getDatePresetRange(txnDatePreset, txnCustomFrom, txnCustomTo);
    return transactions
      .filter((t) => t.supplier_id === supplierId && t.date >= from && t.date <= to)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  // A payment or a sale (cost price paid straight to the supplier) reduces
  // what's owed - everything else (invoices, opening balance) increases it.
  // Mirrors the sign the amount column already uses below.
  function supplierTxnAmount(t: Transaction): number {
    return t.type === 'sale' ? (t.selling_price ?? t.amount ?? 0) : (t.amount ?? 0);
  }
  function supplierTxnSign(t: Transaction): 1 | -1 {
    return t.type === 'supplier_payment' || t.type === 'sale' ? -1 : 1;
  }

  // Running balance after each transaction, computed over the supplier's full
  // history (not just what the date filter currently shows) so it always
  // reflects the true balance at that point in time.
  function getSupplierRunningBalances(supplierId: string): Map<string, number> {
    const all = transactions
      .filter((t) => t.supplier_id === supplierId)
      .slice()
      .sort((a, b) => {
        const d = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (d !== 0) return d;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    const map = new Map<string, number>();
    let running = 0;
    for (const t of all) {
      running += supplierTxnSign(t) * supplierTxnAmount(t);
      map.set(t.id, running);
    }
    return map;
  }

  function getSupplierTotals(supplierId: string) {
    const all = transactions.filter((t) => t.supplier_id === supplierId);
    const invoiced = all.filter((t) => t.type === 'supplier_invoice').reduce((s, t) => s + (t.amount || 0), 0);
    const paid = all
      .filter((t) => t.type === 'supplier_payment' || t.type === 'sale')
      .reduce((s, t) => s + supplierTxnAmount(t), 0);
    return { invoiced, paid };
  }

  const filteredSuppliers = suppliers
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || (s.phone || '').includes(search))
    .slice()
    .sort((a, b) =>
      listSort === 'balance'
        ? Math.abs(b.balance || 0) - Math.abs(a.balance || 0)
        : a.name.localeCompare(b.name)
    );

  const totalOwedToSuppliers = suppliers.reduce((sum, s) => sum + Math.max(s.balance || 0, 0), 0);

  function addBulkPaymentRow() {
    setBulkPaymentForms([...bulkPaymentForms, { ...emptyBulkPaymentRow, date: bulkPaymentForms[0]?.date || todayStr() }]);
  }

  const supplierRunningBalances = selectedSupplier ? getSupplierRunningBalances(selectedSupplier.id) : new Map<string, number>();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setShowAdd(true); setEditingId(null); setForm(emptySupplier); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} /> Add Supplier
          </button>
          <button
            onClick={() => { setShowBulkPayment(true); setBulkPaymentForms(Array.from({ length: 10 }, () => ({ ...emptyBulkPaymentRow, date: todayStr() }))); }}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} /> Bulk Payments
          </button>
          <button
            onClick={() => setShowLedger(true)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <BookOpen size={16} /> View Ledger
          </button>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm">
          <span className="text-red-600">Total Owed to Suppliers: </span>
          <span className="font-semibold text-red-700">KES {formatKES(totalOwedToSuppliers)}</span>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search suppliers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
        <select
          value={listSort}
          onChange={(e) => setListSort(e.target.value as 'balance' | 'name')}
          className="border border-slate-300 rounded-lg text-sm px-2 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="balance">Highest Balance First</option>
          <option value="name">Name (A-Z)</option>
        </select>
      </div>

      {/* Add/Edit Supplier Modal - a real popup, so it's visible no matter how far down the page you've scrolled */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowAdd(false); setEditingId(null); } }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">{editingId ? 'Edit' : 'Add'} Supplier</h3>
            <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                placeholder="Name"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                placeholder="Phone"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <input
              type="number"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
              onKeyDown={(e) => handleFormKeyNav(e)}
              placeholder="Opening Balance (amount owed)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              onKeyDown={(e) => handleFormKeyNav(e, handleSaveSupplier)}
              placeholder="Notes (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <div className="flex items-center gap-2">
              <input type="checkbox" id="dualParty" checked={form.isDualParty} onChange={(e) => setForm({ ...form, isDualParty: e.target.checked })} onKeyDown={(e) => handleFormKeyNav(e)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <label htmlFor="dualParty" className="text-xs text-slate-600">Also a customer (dual-party)</label>
            </div>
            <label className="text-xs text-slate-600">
              Belongs to partner <span className="text-slate-400">(lets settling this party's balance use that partner's Home Expenses Owed / Profit Share / other-role balance)</span>
              <select
                value={form.linkedPartnerId}
                onChange={(e) => setForm({ ...form, linkedPartnerId: e.target.value })}
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">None</option>
                <option value="taher">Taher</option>
                <option value="abdulqadir">Abdulqadir</option>
              </select>
            </label>
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button onClick={guardSupplier(handleSaveSupplier)} disabled={savingSupplier} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium">{savingSupplier ? 'Saving...' : 'Save'}</button>
              <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Bulk Payments - each row picks its own supplier, for logging payments to many
          different suppliers at once */}
      {showBulkPayment && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowBulkPayment(false); }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4 w-full max-w-3xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">Bulk Payments to Suppliers</h3>
            <button onClick={() => setShowBulkPayment(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            {bulkPaymentForms.map((f, i) => (
              <div key={i} className="border border-slate-200 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">#{i + 1}</span>
                  {bulkPaymentForms.length > 1 && (
                    <button
                      onClick={() => setBulkPaymentForms(bulkPaymentForms.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <select
                    value={f.supplierId}
                    onChange={(e) => {
                      const newForms = [...bulkPaymentForms];
                      newForms[i] = { ...newForms[i], supplierId: e.target.value };
                      setBulkPaymentForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">Supplier</option>
                    {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name} ({formatKES(s.balance)})</option>)}
                  </select>
                  <input
                    type="number"
                    value={f.amount}
                    onChange={(e) => {
                      const newForms = [...bulkPaymentForms];
                      newForms[i] = { ...newForms[i], amount: e.target.value };
                      setBulkPaymentForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                    placeholder="Amount"
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <input
                    type="date"
                    value={f.date}
                    onChange={(e) => {
                      const newForms = [...bulkPaymentForms];
                      newForms[i] = { ...newForms[i], date: e.target.value };
                      // Row 1's date drives every other row's date too - each
                      // row can still be changed individually after that.
                      if (i === 0) {
                        for (let j = 1; j < newForms.length; j++) newForms[j] = { ...newForms[j], date: e.target.value };
                      }
                      setBulkPaymentForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <select
                    value={f.mode}
                    onChange={(e) => {
                      const newForms = [...bulkPaymentForms];
                      newForms[i] = { ...newForms[i], mode: e.target.value };
                      setBulkPaymentForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="cash">Cash</option>
                    <option value="mpesa">Mpesa</option>
                    <option value="paybill">Paybill</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={f.notes}
                  onChange={(e) => {
                    const newForms = [...bulkPaymentForms];
                    newForms[i] = { ...newForms[i], notes: e.target.value };
                    setBulkPaymentForms(newForms);
                  }}
                  onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                  placeholder="Notes (optional)"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-2"
                />

                {/* Transaction fee (Mpesa/Paybill only lose money to network fees) */}
                {(f.mode === 'mpesa' || f.mode === 'paybill') && (
                  <input
                    type="number"
                    value={f.transactionFee}
                    onChange={(e) => {
                      const newForms = [...bulkPaymentForms];
                      newForms[i] = { ...newForms[i], transactionFee: e.target.value };
                      setBulkPaymentForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                    placeholder="Transaction fee (optional)"
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-2"
                  />
                )}

                {/* Post-dated cheque (only makes sense for Paybill/Bank) */}
                {f.mode === 'paybill' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={f.isPostDated}
                      onChange={(e) => {
                        const newForms = [...bulkPaymentForms];
                        newForms[i] = { ...newForms[i], isPostDated: e.target.checked };
                        setBulkPaymentForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label className="text-xs text-slate-600">Post-dated cheque</label>
                    {f.isPostDated && (
                      <input
                        type="date"
                        value={f.clearsOn}
                        onChange={(e) => {
                          const newForms = [...bulkPaymentForms];
                          newForms[i] = { ...newForms[i], clearsOn: e.target.value };
                          setBulkPaymentForms(newForms);
                        }}
                        onKeyDown={(e) => handleFormKeyNav(e, addBulkPaymentRow)}
                        className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                        placeholder="Clears on"
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-3 pt-3 border-t border-slate-200">
            <button
              onClick={addBulkPaymentRow}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded text-sm font-medium flex items-center gap-1"
            >
              <Plus size={14} /> Add Row
            </button>
            <button onClick={handleBulkPaymentSave} disabled={bulkPaymentSaving} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium">
              {bulkPaymentSaving ? 'Saving...' : 'Save All'}
            </button>
            <button onClick={() => setShowBulkPayment(false)} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
          </div>
        </div>
        </div>
      )}

      {/* Split Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Supplier List */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-1">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Suppliers ({filteredSuppliers.length})</h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-slate-400">Loading...</div>
            ) : filteredSuppliers.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No suppliers found</div>
            ) : (
              filteredSuppliers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSupplier(s)}
                  className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors ${
                    selectedSupplier?.id === s.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''
                  }`}
                >
                  <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-medium uppercase text-slate-600">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.phone || 'No phone'}</p>
                  </div>
                  {(s.balance || 0) > 0 && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{formatKES(s.balance)}</span>
                  )}
                  {(s.balance || 0) < 0 && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full" title="Supplier owes you">Cr: {formatKES(Math.abs(s.balance))}</span>
                  )}
                  {s.is_dual_party && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Dual</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Supplier Detail */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          {selectedSupplier ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-sm font-medium uppercase text-emerald-700">
                    {selectedSupplier.name[0]}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">{selectedSupplier.name}</h3>
                    <p className="text-xs text-slate-500">{selectedSupplier.phone || 'No phone'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(selectedSupplier)} className="p-1.5 hover:bg-slate-100 rounded">
                    <Edit2 size={14} className="text-slate-500" />
                  </button>
                  <button onClick={() => { setShowInvoice(true); setEditingInvoiceId(null); setInvoiceForm({ ...emptyInvoice, date: todayStr() }); }} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add Invoice</button>
                  <button onClick={() => { setShowPayment(true); setPaymentForm({ ...emptyPayment, date: todayStr() }); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Pay Supplier</button>
                </div>
              </div>

              {/* Balance + Totals */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className={`rounded-lg p-4 border ${(selectedSupplier.balance || 0) < 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                  <p className={`text-sm ${(selectedSupplier.balance || 0) < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {(selectedSupplier.balance || 0) < 0 ? 'Supplier Owes You (Credit)' : 'Balance Owed'}
                  </p>
                  <p className={`text-2xl font-bold ${(selectedSupplier.balance || 0) < 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    KES {formatKES(Math.abs(selectedSupplier.balance || 0))}
                  </p>
                </div>
                <div className="rounded-lg p-4 border bg-amber-50 border-amber-100">
                  <p className="text-sm text-amber-600">Total Invoiced</p>
                  <p className="text-2xl font-bold text-amber-700">
                    KES {formatKES(getSupplierTotals(selectedSupplier.id).invoiced)}
                  </p>
                </div>
                <div className="rounded-lg p-4 border bg-slate-50 border-slate-200">
                  <p className="text-sm text-slate-600">Total Paid</p>
                  <p className="text-2xl font-bold text-slate-700">
                    KES {formatKES(getSupplierTotals(selectedSupplier.id).paid)}
                  </p>
                </div>
              </div>

              {/* Netting banner - only when this supplier is linked to a partner
                  and BOTH sides owe something (shop owes them as supplier, AND
                  they owe the shop as customer) - lets it be netted in one click
                  instead of going through the full Pay Supplier form. */}
              {(() => {
                if (!selectedSupplier.linked_partner_id) return null;
                const linkedCustomer = linkedCustomerFor(selectedSupplier.linked_partner_id);
                if (!linkedCustomer) return null;
                const supplierOwed = selectedSupplier.balance || 0;
                const customerOwed = linkedCustomer.credit_balance || 0;
                if (supplierOwed <= 0 || customerOwed <= 0) return null;
                const netAmount = Math.min(supplierOwed, customerOwed);
                return (
                  <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-3">
                    <p className="text-sm text-amber-800">
                      {selectedSupplier.name} also owes you KES {formatKES(customerOwed)} as a customer. KES {formatKES(netAmount)} can be netted against this supplier balance.
                    </p>
                    <label className="flex items-center gap-2 mt-2 text-sm text-amber-800">
                      <input
                        type="checkbox"
                        checked={netChecked}
                        onChange={(e) => setNetChecked(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      Yes, deduct KES {formatKES(netAmount)} from both balances
                    </label>
                    {netChecked && (
                      <button
                        onClick={() => handleNetCrossBalance(netAmount)}
                        className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium"
                      >
                        Apply Net
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Transaction History */}
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h4 className="text-sm font-semibold text-slate-700">Transaction History</h4>
                <DateFilterBar
                  preset={txnDatePreset}
                  customFrom={txnCustomFrom}
                  customTo={txnCustomTo}
                  onChange={(p, from, to) => { setTxnDatePreset(p); setTxnCustomFrom(from); setTxnCustomTo(to); }}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getSupplierTransactions(selectedSupplier.id).length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 text-xs">No transactions</td></tr>
                    ) : (
                      getSupplierTransactions(selectedSupplier.id).map((t) => {
                        const runningBalance = supplierRunningBalances.get(t.id) ?? 0;
                        return (
                        <Fragment key={t.id}>
                        <tr className={`hover:bg-slate-50 transition-colors ${isSaleIncomplete(t) ? 'bg-green-50' : ''}`} title={isSaleIncomplete(t) ? 'Missing payment mode, cost price, or selling price' : undefined}>
                          <td className="px-3 py-2 text-slate-600">
                            {formatDate(t.date)}
                            <span className="block text-xs text-slate-400">{formatTime(t.created_at)}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              t.type === 'expense' ? 'bg-red-100 text-red-700' :
                              t.type === 'supplier_invoice' ? 'bg-amber-100 text-amber-700' :
                              t.type === 'supplier_payment' || t.type === 'sale' ? 'bg-emerald-100 text-emerald-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {t.type === 'supplier_payment' ? 'Payment' : t.type === 'supplier_invoice' ? 'Invoice' : t.type === 'sale' ? 'Payment (Sale)' : t.type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {t.description || '-'}
                            {t.clears_on && (
                              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                                t.clears_on > todayStr() ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                              }`} title="Post-dated cheque">
                                {t.clears_on > todayStr() ? `Clears ${formatDate(t.clears_on)}` : 'Cleared'}
                              </span>
                            )}
                            {t.created_by && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Added by">
                                {t.created_by}
                              </span>
                            )}
                            {t.edited_at && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title={`Edited ${formatDate(t.edited_at)}`}>
                                Edited
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right font-medium ${
                            t.type === 'supplier_payment' || t.type === 'sale' ? 'text-emerald-600' : 'text-red-600'
                          }`}>
                            {t.type === 'supplier_payment' || t.type === 'sale' ? '-' : '+'}{formatKES(t.type === 'sale' ? (t.selling_price ?? t.amount) : t.amount)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {formatKES(Math.abs(runningBalance))}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {t.type === 'supplier_payment' && (
                                <button onClick={() => startEditPayment(t)} className="p-1 hover:bg-slate-200 rounded">
                                  <Edit2 size={14} className="text-slate-500" />
                                </button>
                              )}
                              {t.type === 'supplier_invoice' && (
                                <button onClick={() => startEditInvoice(t)} className="p-1 hover:bg-slate-200 rounded">
                                  <Edit2 size={14} className="text-slate-500" />
                                </button>
                              )}
                              {t.type === 'sale' && (
                                <button onClick={() => navigate(`/sales?edit=${t.id}`)} className="p-1 hover:bg-slate-200 rounded" title="Edit on Sales page">
                                  <Edit2 size={14} className="text-slate-500" />
                                </button>
                              )}
                              {t.type === 'expense' && (
                                <button onClick={() => navigate(`/expenses?edit=${t.id}`)} className="p-1 hover:bg-slate-200 rounded" title="Edit on Expenses page">
                                  <Edit2 size={14} className="text-slate-500" />
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (confirm('Void this transaction?')) handleVoidTransaction(t.id);
                                }}
                                className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded transition-colors"
                              >
                                Void
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editingPaymentId === t.id && (
                          <tr>
                            <td colSpan={6} className="px-3 py-3 bg-slate-50">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <input
                                  type="date"
                                  value={paymentEditForm.date}
                                  onChange={(e) => setPaymentEditForm({ ...paymentEditForm, date: e.target.value })}
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  value={paymentEditForm.amount}
                                  onChange={(e) => setPaymentEditForm({ ...paymentEditForm, amount: e.target.value })}
                                  placeholder="Amount"
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <select
                                  value={paymentEditForm.mode}
                                  onChange={(e) => setPaymentEditForm({ ...paymentEditForm, mode: e.target.value })}
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                >
                                  <option value="cash">Cash</option>
                                  <option value="mpesa">Mpesa</option>
                                  <option value="paybill">Paybill</option>
                                </select>
                                <input
                                  type="text"
                                  value={paymentEditForm.notes}
                                  onChange={(e) => setPaymentEditForm({ ...paymentEditForm, notes: e.target.value })}
                                  placeholder="Notes"
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                              </div>
                              <p className="text-xs text-slate-500 mt-1">Mode only changes the cash portion - any Home Expense/Share/Mohamedi's balance used stays as it was.</p>
                              <div className="flex gap-2 mt-2">
                                <button onClick={handleUpdatePayment} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">Save</button>
                                <button onClick={() => { setEditingPaymentId(null); setPaymentEditForm({ amount: '', date: '', mode: 'cash', notes: '' }); }} className="text-slate-500 hover:text-slate-700 text-xs">Cancel</button>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400">Select a supplier to view details</div>
          )}
        </div>
      </div>

      {/* Invoice Modal */}
      {showInvoice && selectedSupplier && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') { setShowInvoice(false); setEditingInvoiceId(null); } }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">{editingInvoiceId ? 'Edit Invoice' : 'Invoice'} - {selectedSupplier.name}</h3>
              <button onClick={() => { setShowInvoice(false); setEditingInvoiceId(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={invoiceForm.date}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, date: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="number"
                  value={invoiceForm.amount}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  placeholder="Amount"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <input
                type="date"
                value={invoiceForm.dueDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                placeholder="Due Date"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="text"
                value={invoiceForm.notes}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                placeholder="Notes (optional)"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              {!editingInvoiceId && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="setReminder"
                    checked={invoiceForm.setReminder}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, setReminder: e.target.checked })}
                    onKeyDown={(e) => handleFormKeyNav(e)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="setReminder" className="text-xs text-slate-600">Set reminder</label>
                  {invoiceForm.setReminder && (
                    <input
                      type="date"
                      value={invoiceForm.reminderDate}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, reminderDate: e.target.value })}
                      onKeyDown={(e) => handleFormKeyNav(e, handleAddInvoice)}
                      className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                      placeholder="Reminder date"
                    />
                  )}
                </div>
              )}
              <button onClick={guardInvoice(handleAddInvoice)} disabled={savingInvoice} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">{savingInvoice ? 'Saving...' : editingInvoiceId ? 'Save Invoice' : 'Add Invoice'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && selectedSupplier && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setShowPayment(false); }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Pay - {selectedSupplier.name}</h3>
              <button onClick={() => setShowPayment(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  placeholder="Amount"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="date"
                  value={paymentForm.date}
                  onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <select
                  value={paymentForm.mode}
                  onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">Mpesa</option>
                  <option value="paybill">Paybill</option>
                </select>
              </div>
              {(paymentForm.mode === 'mpesa' || paymentForm.mode === 'paybill') && (
                <input
                  type="number"
                  value={paymentForm.transactionFee}
                  onChange={(e) => setPaymentForm({ ...paymentForm, transactionFee: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  placeholder="Transaction fee (optional)"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              )}
              {paymentForm.mode === 'paybill' && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="paymentPostDated"
                    checked={paymentForm.isPostDated}
                    onChange={(e) => setPaymentForm({ ...paymentForm, isPostDated: e.target.checked })}
                    onKeyDown={(e) => handleFormKeyNav(e)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="paymentPostDated" className="text-xs text-slate-600">Post-dated cheque</label>
                  {paymentForm.isPostDated && (
                    <input
                      type="date"
                      value={paymentForm.clearsOn}
                      onChange={(e) => setPaymentForm({ ...paymentForm, clearsOn: e.target.value })}
                      onKeyDown={(e) => handleFormKeyNav(e)}
                      className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                      placeholder="Clears on"
                    />
                  )}
                </div>
              )}
              {selectedSupplier.linked_partner_id && (
                <SettlementModeFields
                  partnerLabel={selectedSupplier.linked_partner_id === 'abdulqadir' ? 'Abdulqadir' : 'Taher'}
                  crossLabel="Mohamedi's Customer Balance"
                  available={computeSettlementAvailable(
                    transactions,
                    shareRules,
                    historicalProfit,
                    selectedSupplier.linked_partner_id,
                    linkedCustomerFor(selectedSupplier.linked_partner_id)?.credit_balance || 0
                  )}
                  amounts={paymentForm.settlement}
                  onChange={(next) => setPaymentForm({ ...paymentForm, settlement: next })}
                />
              )}
              <input
                type="text"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e, handlePayment)}
                placeholder="Notes (optional)"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <button onClick={guardPayment(handlePayment)} disabled={savingPayment} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">{savingPayment ? 'Saving...' : 'Pay Supplier'}</button>
            </div>
          </div>
        </div>
      )}

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title="Supplier Ledger"
        filterTypes={['supplier_invoice', 'supplier_payment']}
      />
    </div>
  );
}