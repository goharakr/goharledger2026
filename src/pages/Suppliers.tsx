import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  X,
  Save,
  ArrowRight,
  Trash2,
  Edit2,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, todayStr, isSaleIncomplete } from '../utils/format';
import { adjustSupplierBalance } from '../utils/balances';
import { insertTransactionWithId } from '../utils/transactionId';
import { fetchAllRows } from '../utils/fetchAll';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import LedgerModal from '../components/LedgerModal';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Supplier, Transaction } from '../types';

interface SupplierForm {
  name: string;
  phone: string;
  notes: string;
  isDualParty: boolean;
  openingBalance: string;
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
}

const emptySupplier: SupplierForm = {
  name: '',
  phone: '',
  notes: '',
  isDualParty: false,
  openingBalance: '',
};

const emptyInvoice: InvoiceForm = {
  date: new Date().toISOString().split('T')[0],
  dueDate: '',
  amount: '',
  notes: '',
  setReminder: false,
  reminderDate: '',
};

const emptyPayment: PaymentForm = {
  amount: '',
  date: new Date().toISOString().split('T')[0],
  mode: 'cash',
  notes: '',
  isPostDated: false,
  clearsOn: '',
  transactionFee: '',
};

export default function Suppliers() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [form, setForm] = useState<SupplierForm>(emptySupplier);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm>(emptyInvoice);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPayment);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [txnDatePreset, setTxnDatePreset] = useState<DatePreset>('month');
  const [txnCustomFrom, setTxnCustomFrom] = useState('');
  const [txnCustomTo, setTxnCustomTo] = useState('');

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  useEffect(() => {
    if (selectedSupplier) {
      const updated = suppliers.find((s) => s.id === selectedSupplier.id);
      if (updated) setSelectedSupplier(updated);
    }
  }, [suppliers]);

  async function fetchData() {
    setLoading(true);
    const [{ data: supp }, { data: txns }] = await Promise.all([
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }).range(from, to)
      ),
    ]);
    setSuppliers(supp || []);
    setTransactions(txns || []);
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
    if (!form.name.trim()) return;

    const newOpening = parseFloat(form.openingBalance || '0');

    if (editingId) {
      await supabase.from('suppliers').update({
        name: form.name.trim(),
        phone: form.phone || null,
        notes: form.notes || null,
        is_dual_party: form.isDualParty,
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

  async function handleAddInvoice() {
    if (!selectedSupplier || !invoiceForm.amount || parseFloat(invoiceForm.amount) <= 0) return;

    const amt = parseFloat(invoiceForm.amount);

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

  async function handlePayment() {
    if (!selectedSupplier || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0) return;

    const amt = parseFloat(paymentForm.amount);

    const { data: newTxn, error } = await insertTransactionWithId('SUP-' + paymentForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: paymentForm.date,
      type: 'supplier_payment',
      primary_mode: paymentForm.mode as any,
      amount: amt,
      supplier_id: selectedSupplier.id,
      description: `Payment to ${selectedSupplier.name}`,
      notes: paymentForm.notes || null,
      clears_on: paymentForm.mode === 'paybill' && paymentForm.isPostDated && paymentForm.clearsOn ? paymentForm.clearsOn : null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save payment: ' + (error?.message || 'unknown error')); return; }

    await adjustSupplierBalance(selectedSupplier.id, -amt);
    await insertTransactionFee(paymentForm.date, paymentForm.mode, paymentForm.transactionFee, selectedSupplier.name);

    setPaymentForm(emptyPayment);
    setShowPayment(false);
    refreshSupplierData();
  }

  async function handleVoidTransaction(id: string) {
    const txn = transactions.find((t) => t.id === id);
    if (!txn) return;

    if (txn.supplier_id && txn.type === 'expense' && (txn.category === 'supplier_payment' || txn.category === 'stock')) {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
    }
    if (txn.supplier_id && txn.type === 'supplier_payment') {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
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

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    const opening = transactions.find((t) => t.transaction_id === openingBalanceTxnId(supplier.id));
    setForm({
      name: supplier.name,
      phone: supplier.phone || '',
      notes: supplier.notes || '',
      isDualParty: supplier.is_dual_party,
      openingBalance: String(opening?.amount || 0),
    });
    setShowAdd(true);
  }

  function getSupplierTransactions(supplierId: string) {
    const { from, to } = getDatePresetRange(txnDatePreset, txnCustomFrom, txnCustomTo);
    return transactions
      .filter((t) => t.supplier_id === supplierId && t.date >= from && t.date <= to)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.phone || '').includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { setShowAdd(true); setEditingId(null); setForm(emptySupplier); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} /> Add Supplier
        </button>
        <button
          onClick={() => setShowLedger(true)}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
      </div>

      {/* Add/Edit Supplier Modal */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
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
                placeholder="Name"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <input
              type="number"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
              placeholder="Opening Balance (amount owed)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveSupplier(); }}}
              placeholder="Notes (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <div className="flex items-center gap-2">
              <input type="checkbox" id="dualParty" checked={form.isDualParty} onChange={(e) => setForm({ ...form, isDualParty: e.target.checked })} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <label htmlFor="dualParty" className="text-xs text-slate-600">Also a customer (dual-party)</label>
            </div>
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button onClick={handleSaveSupplier} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium">Save</button>
              <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
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
                  <button onClick={() => { setShowInvoice(true); setInvoiceForm({ ...emptyInvoice, date: todayStr() }); }} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add Invoice</button>
                  <button onClick={() => { setShowPayment(true); setPaymentForm({ ...emptyPayment, date: todayStr() }); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Pay Supplier</button>
                </div>
              </div>

              {/* Balance */}
              <div className={`rounded-lg p-4 border mb-4 ${(selectedSupplier.balance || 0) < 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                <p className={`text-sm ${(selectedSupplier.balance || 0) < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {(selectedSupplier.balance || 0) < 0 ? 'Supplier Owes You (Credit)' : 'Balance Owed'}
                </p>
                <p className={`text-2xl font-bold ${(selectedSupplier.balance || 0) < 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  KES {formatKES(Math.abs(selectedSupplier.balance || 0))}
                </p>
              </div>

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
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getSupplierTransactions(selectedSupplier.id).length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400 text-xs">No transactions</td></tr>
                    ) : (
                      getSupplierTransactions(selectedSupplier.id).map((t) => (
                        <tr key={t.id} className={`hover:bg-slate-50 transition-colors ${isSaleIncomplete(t) ? 'bg-green-50' : ''}`} title={isSaleIncomplete(t) ? 'Missing payment mode, cost price, or selling price' : undefined}>
                          <td className="px-3 py-2 text-slate-600">{formatDate(t.date)}</td>
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
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => {
                                if (confirm('Void this transaction?')) handleVoidTransaction(t.id);
                              }}
                              className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded transition-colors"
                            >
                              Void
                            </button>
                          </td>
                        </tr>
                      ))
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Invoice - {selectedSupplier.name}</h3>
              <button onClick={() => setShowInvoice(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={invoiceForm.date}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, date: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="number"
                  value={invoiceForm.amount}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                  placeholder="Amount"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <input
                type="date"
                value={invoiceForm.dueDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                placeholder="Due Date"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="text"
                value={invoiceForm.notes}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                placeholder="Notes (optional)"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="setReminder"
                  checked={invoiceForm.setReminder}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, setReminder: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="setReminder" className="text-xs text-slate-600">Set reminder</label>
                {invoiceForm.setReminder && (
                  <input
                    type="date"
                    value={invoiceForm.reminderDate}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, reminderDate: e.target.value })}
                    className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                    placeholder="Reminder date"
                  />
                )}
              </div>
              <button onClick={handleAddInvoice} className="w-full bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded text-sm font-medium">Add Invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && selectedSupplier && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Pay - {selectedSupplier.name}</h3>
              <button onClick={() => setShowPayment(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  placeholder="Amount"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="date"
                  value={paymentForm.date}
                  onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <select
                  value={paymentForm.mode}
                  onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value })}
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
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="paymentPostDated" className="text-xs text-slate-600">Post-dated cheque</label>
                  {paymentForm.isPostDated && (
                    <input
                      type="date"
                      value={paymentForm.clearsOn}
                      onChange={(e) => setPaymentForm({ ...paymentForm, clearsOn: e.target.value })}
                      className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                      placeholder="Clears on"
                    />
                  )}
                </div>
              )}
              <input
                type="text"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handlePayment(); }}}
                placeholder="Notes (optional)"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <button onClick={handlePayment} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded text-sm font-medium">Pay Supplier</button>
            </div>
          </div>
        </div>
      )}

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title="Supplier Ledger"
        filterTypes={['supplier_invoice', 'supplier_payment', 'expense']}
      />
    </div>
  );
}