import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  Save,
  UserPlus,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, generateTransactionId, todayStr } from '../utils/format';
import { adjustCustomerCredit, adjustCustomerAdvance, adjustSupplierBalance } from '../utils/balances';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import LedgerModal from '../components/LedgerModal';
import type { Transaction, Customer, Supplier } from '../types';

type SaleMode = 'cash' | 'mpesa' | 'paybill' | 'split' | 'credit' | 'advance' | 'supplier';

interface SaleForm {
  date: string;
  mode: SaleMode;
  sellingPrice: string;
  costPrice: string;
  commission: string;
  commissionMode: string;
  notes: string;
  customerId: string;
  supplierId: string;
  splitMpesa: string;
  splitCash: string;
  splitPaybill: string;
  isUnclassified: boolean;
  advanceMode: string;
}

const emptyForm: SaleForm = {
  date: new Date().toISOString().split('T')[0],
  mode: 'cash',
  sellingPrice: '',
  costPrice: '',
  commission: '',
  commissionMode: 'cash',
  notes: '',
  customerId: '',
  supplierId: '',
  splitMpesa: '',
  splitCash: '',
  splitPaybill: '',
  isUnclassified: false,
  advanceMode: 'cash',
};

export default function Sales() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [sales, setSales] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [bulkForms, setBulkForms] = useState<SaleForm[]>([emptyForm, emptyForm, emptyForm]);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<string>('');
  const [filterDate, setFilterDate] = useState('');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [showLedger, setShowLedger] = useState(false);
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false);
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({ name: '', phone: '', creditLimit: '' });
  const [quickSupplier, setQuickSupplier] = useState({ name: '', phone: '', balance: '' });

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: splitData }, { data: cust }, { data: supp }] = await Promise.all([
      supabase.from('transactions').select('*').eq('type', 'sale').order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('transaction_splits').select('*'),
      supabase.from('customers').select('*').eq('is_active', true),
      supabase.from('suppliers').select('*').eq('is_active', true),
    ]);
    setSales(txns || []);
    setSplits(splitData || []);
    setCustomers(cust || []);
    setSuppliers(supp || []);
    setLoading(false);
  }

  async function getNextTransactionId(date: string): Promise<string> {
    const prefix = 'SAL-' + date.replace(/-/g, '');
    const { data } = await supabase
      .from('transactions')
      .select('transaction_id')
      .like('transaction_id', `${prefix}%`)
      .order('transaction_id', { ascending: false })
      .limit(1);

    let seq = 1;
    if (data && data.length > 0) {
      const last = data[0].transaction_id;
      const match = last.match(/-(\d{3})$/);
      if (match) seq = parseInt(match[1]) + 1;
    }
    return `${prefix}-${String(seq).padStart(3, '0')}`;
  }

  async function handleQuickAddCustomer() {
    if (!quickCustomer.name) return;
    const { data } = await supabase.from('customers').insert({
      name: quickCustomer.name,
      phone: quickCustomer.phone || null,
      credit_limit: parseFloat(quickCustomer.creditLimit || '0'),
    }).select().single();
    if (data) {
      setCustomers((prev) => [...prev, data]);
      setForm((f) => ({ ...f, customerId: data.id }));
      setShowQuickAddCustomer(false);
      setQuickCustomer({ name: '', phone: '', creditLimit: '' });
    }
  }

  async function handleQuickAddSupplier() {
    if (!quickSupplier.name) return;
    const openingBalance = parseFloat(quickSupplier.balance || '0');
    const { data } = await supabase.from('suppliers').insert({
      name: quickSupplier.name,
      phone: quickSupplier.phone || null,
      balance: openingBalance,
    }).select().single();
    if (data) {
      // Mirror a nonzero opening balance into transactions so it shows up in
      // Reports/the Ledger with a visible origin, and can be edited/deleted later
      if (openingBalance > 0) {
        await supabase.from('transactions').insert({
          transaction_id: `OPN-BAL-${data.id}`,
          date: todayStr(),
          type: 'supplier_invoice',
          primary_mode: null,
          amount: openingBalance,
          supplier_id: data.id,
          description: `Opening balance - ${data.name}`,
          created_by: user?.username || null,
        });
      }
      setSuppliers((prev) => [...prev, data]);
      setForm((f) => ({ ...f, supplierId: data.id }));
      setShowQuickAddSupplier(false);
      setQuickSupplier({ name: '', phone: '', balance: '' });
    }
  }

  async function handleSave() {
    if (!form.sellingPrice || parseFloat(form.sellingPrice) <= 0) return;

    const sp = parseFloat(form.sellingPrice);
    const cp = parseFloat(form.costPrice || '0');
    const comm = parseFloat(form.commission || '0');

    const txnId = await getNextTransactionId(form.date);

    // For advance mode, use the selected advanceMode as the actual payment mode
    const actualMode = form.mode === 'advance' ? form.advanceMode : form.mode;

    const txnData: any = {
      transaction_id: txnId,
      date: form.date,
      type: 'sale',
      primary_mode: actualMode,
      amount: sp,
      description: form.notes || null,
      notes: form.notes || null,
      selling_price: sp,
      cost_price: cp || null,
      commission: comm || null,
      commission_mode: comm > 0 ? form.commissionMode : null,
      is_unclassified: form.isUnclassified,
      customer_id: form.mode === 'credit' || form.mode === 'advance' ? (form.customerId || null) : null,
      supplier_id: form.mode === 'supplier' ? (form.supplierId || null) : null,
      created_by: user?.username || null,
    };

    // Store the original mode for advance tracking
    if (form.mode === 'advance') {
      txnData.notes = `Advance payment via ${form.advanceMode}${form.notes ? ' | ' + form.notes : ''}`;
    }

    const { data: newTxn, error } = await supabase.from('transactions').insert(txnData).select().single();
    if (error) { console.error(error); return; }

    // For split mode, store the split amounts
    if (form.mode === 'split') {
      const splits = [];
      if (parseFloat(form.splitMpesa || '0') > 0) splits.push({ transaction_id: txnId, mode: 'mpesa', amount: parseFloat(form.splitMpesa) });
      if (parseFloat(form.splitCash || '0') > 0) splits.push({ transaction_id: txnId, mode: 'cash', amount: parseFloat(form.splitCash) });
      if (parseFloat(form.splitPaybill || '0') > 0) splits.push({ transaction_id: txnId, mode: 'paybill', amount: parseFloat(form.splitPaybill) });
      if (splits.length > 0) await supabase.from('transaction_splits').insert(splits);
    }

    // For advance mode, the sale is paid for out of the customer's existing
    // advance/prepaid balance, so it spends it down (not up)
    if (form.mode === 'advance' && form.customerId) {
      await adjustCustomerAdvance(form.customerId, -sp);
    }

    if (form.mode === 'credit' && form.customerId) {
      await adjustCustomerCredit(form.customerId, sp);
    }

    if (form.mode === 'supplier' && form.supplierId) {
      await adjustSupplierBalance(form.supplierId, -sp);
    }

    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
  }

  async function handleBulkSave() {
    const validForms = bulkForms.filter((f) => f.sellingPrice && parseFloat(f.sellingPrice) > 0);
    if (validForms.length === 0) return;

    for (let i = 0; i < validForms.length; i++) {
      const f = validForms[i];
      const sp = parseFloat(f.sellingPrice);
      const cp = parseFloat(f.costPrice || '0');
      const comm = parseFloat(f.commission || '0');
      const txnId = await getNextTransactionId(f.date);

      const txnData: any = {
        transaction_id: txnId,
        date: f.date,
        type: 'sale',
        primary_mode: f.mode,
        amount: sp,
        description: f.notes || null,
        notes: f.notes || null,
        selling_price: sp,
        cost_price: cp || null,
        commission: comm || null,
        commission_mode: comm > 0 ? f.commissionMode : null,
        is_unclassified: f.isUnclassified,
        customer_id: f.mode === 'credit' || f.mode === 'advance' ? (f.customerId || null) : null,
        supplier_id: f.mode === 'supplier' ? (f.supplierId || null) : null,
        created_by: user?.username || null,
      };

      const { data: newTxn } = await supabase.from('transactions').insert(txnData).select().single();
      if (!newTxn) continue;

      if (f.mode === 'split') {
        const splits = [];
        if (parseFloat(f.splitMpesa || '0') > 0) splits.push({ transaction_id: txnId, mode: 'mpesa', amount: parseFloat(f.splitMpesa) });
        if (parseFloat(f.splitCash || '0') > 0) splits.push({ transaction_id: txnId, mode: 'cash', amount: parseFloat(f.splitCash) });
        if (parseFloat(f.splitPaybill || '0') > 0) splits.push({ transaction_id: txnId, mode: 'paybill', amount: parseFloat(f.splitPaybill) });
        if (splits.length > 0) await supabase.from('transaction_splits').insert(splits);
      }

      if (f.mode === 'credit' && f.customerId) {
        await adjustCustomerCredit(f.customerId, sp);
      }
      if (f.mode === 'advance' && f.customerId) {
        await adjustCustomerAdvance(f.customerId, -sp);
      }
      if (f.mode === 'supplier' && f.supplierId) {
        await adjustSupplierBalance(f.supplierId, -sp);
      }
    }

    setBulkForms([emptyForm, emptyForm, emptyForm]);
    setShowBulk(false);
    fetchData();
    triggerRefresh();
  }

  async function handleVoid(id: string, reason: string) {
    const txn = sales.find((s) => s.id === id);
    if (!txn) return;

    // Reverse customer/supplier balances
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

    await supabase.from('transactions').update({ is_void: true, void_reason: reason }).eq('id', id);
    fetchData();
    triggerRefresh();
  }

  async function handleUpdate() {
    if (!editingId) return;
    const oldTxn = sales.find((s) => s.id === editingId);
    if (!oldTxn) return;

    const sp = parseFloat(form.sellingPrice);
    const cp = parseFloat(form.costPrice || '0');
    const comm = parseFloat(form.commission || '0');

    // Reverse old customer/supplier effects
    if (oldTxn.customer_id && (oldTxn.primary_mode === 'credit' || oldTxn.primary_mode === 'advance')) {
      if (oldTxn.primary_mode === 'credit') {
        await adjustCustomerCredit(oldTxn.customer_id, -(oldTxn.amount || 0));
      } else {
        await adjustCustomerAdvance(oldTxn.customer_id, oldTxn.amount || 0);
      }
    }
    if (oldTxn.supplier_id && oldTxn.primary_mode === 'supplier') {
      await adjustSupplierBalance(oldTxn.supplier_id, oldTxn.amount || 0);
    }

    // Update transaction
    await supabase.from('transactions').update({
      date: form.date,
      primary_mode: form.mode,
      amount: sp,
      description: form.description || null,
      notes: form.notes || null,
      selling_price: sp,
      cost_price: cp || null,
      commission: comm || null,
      commission_mode: comm > 0 ? form.commissionMode : null,
      is_unclassified: form.isUnclassified,
      customer_id: form.mode === 'credit' || form.mode === 'advance' ? (form.customerId || null) : null,
      supplier_id: form.mode === 'supplier' ? (form.supplierId || null) : null,
      edited_at: new Date().toISOString(),
    }).eq('id', editingId);

    // Replace the split breakdown to match the (possibly new) mode/amounts -
    // old rows are cleared first so switching away from split mode, or
    // changing the amounts, never leaves a stale/mismatched breakdown behind
    await supabase.from('transaction_splits').delete().eq('transaction_id', oldTxn.transaction_id);
    if (form.mode === 'split') {
      const newSplits = [];
      if (parseFloat(form.splitMpesa || '0') > 0) newSplits.push({ transaction_id: oldTxn.transaction_id, mode: 'mpesa', amount: parseFloat(form.splitMpesa) });
      if (parseFloat(form.splitCash || '0') > 0) newSplits.push({ transaction_id: oldTxn.transaction_id, mode: 'cash', amount: parseFloat(form.splitCash) });
      if (parseFloat(form.splitPaybill || '0') > 0) newSplits.push({ transaction_id: oldTxn.transaction_id, mode: 'paybill', amount: parseFloat(form.splitPaybill) });
      if (newSplits.length > 0) await supabase.from('transaction_splits').insert(newSplits);
    }

    // Apply new customer/supplier effects
    if (form.mode === 'credit' && form.customerId) {
      await adjustCustomerCredit(form.customerId, sp);
    }
    if (form.mode === 'advance' && form.customerId) {
      await adjustCustomerAdvance(form.customerId, -sp);
    }
    if (form.mode === 'supplier' && form.supplierId) {
      await adjustSupplierBalance(form.supplierId, -sp);
    }

    setEditingId(null);
    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
  }

  function startEdit(sale: Transaction) {
    setEditingId(sale.id);
    const existingSplits = splits.filter((s) => s.transaction_id === sale.transaction_id);
    setForm({
      date: sale.date,
      mode: (sale.primary_mode as SaleMode) || 'cash',
      sellingPrice: String(sale.selling_price || ''),
      costPrice: String(sale.cost_price || ''),
      commission: String(sale.commission || ''),
      commissionMode: sale.commission_mode || 'cash',
      notes: sale.description || sale.notes || '',
      customerId: sale.customer_id || '',
      supplierId: sale.supplier_id || '',
      splitMpesa: String(existingSplits.find((s) => s.mode === 'mpesa')?.amount || ''),
      splitCash: String(existingSplits.find((s) => s.mode === 'cash')?.amount || ''),
      splitPaybill: String(existingSplits.find((s) => s.mode === 'paybill')?.amount || ''),
      isUnclassified: sale.is_unclassified,
      advanceMode: 'cash',
    });
    setShowAdd(true);
  }

  const grouped = new Map<string, Transaction[]>();
  const filtered = sales.filter((s) => {
    if (s.is_void) return false;
    if (search && !s.description?.toLowerCase().includes(search.toLowerCase()) && !s.transaction_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterMode && s.primary_mode !== filterMode) return false;
    if (filterDate && s.date !== filterDate) return false;
    return true;
  });

  filtered.forEach((s) => {
    if (!grouped.has(s.date)) grouped.set(s.date, []);
    grouped.get(s.date)!.push(s);
  });

  const sortedDates = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { setShowAdd(true); setShowBulk(false); setEditingId(null); setForm({ ...emptyForm, date: todayStr() }); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus size={16} /> Add Sale
        </button>
        <button
          onClick={() => { setShowBulk(true); setShowAdd(false); setEditingId(null); setBulkForms([{ ...emptyForm, date: todayStr() }, { ...emptyForm, date: todayStr() }, { ...emptyForm, date: todayStr() }]); }}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus size={16} /> Bulk Entry
        </button>
        <button
          onClick={() => setShowLedger(true)}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search sales..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
        <select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="">All Modes</option>
          <option value="cash">Cash</option>
          <option value="mpesa">Mpesa</option>
          <option value="paybill">Paybill</option>
          <option value="split">Split</option>
          <option value="credit">Credit</option>
          <option value="advance">Advance</option>
          <option value="supplier">Supplier</option>
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        {(search || filterMode || filterDate) && (
          <button
            onClick={() => { setSearch(''); setFilterMode(''); setFilterDate(''); }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">{editingId ? 'Edit Sale' : 'Add Sale'}</h3>
            <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="p-1 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>
          <SaleFormFields
            form={form}
            setForm={setForm}
            customers={customers}
            suppliers={suppliers}
            onSave={editingId ? handleUpdate : handleSave}
            onCancel={() => { setShowAdd(false); setEditingId(null); }}
            saveLabel={editingId ? 'Update' : 'Save'}
            showQuickAddCustomer={showQuickAddCustomer}
            setShowQuickAddCustomer={setShowQuickAddCustomer}
            quickCustomer={quickCustomer}
            setQuickCustomer={setQuickCustomer}
            onQuickAddCustomer={handleQuickAddCustomer}
            showQuickAddSupplier={showQuickAddSupplier}
            setShowQuickAddSupplier={setShowQuickAddSupplier}
            quickSupplier={quickSupplier}
            setQuickSupplier={setQuickSupplier}
            onQuickAddSupplier={handleQuickAddSupplier}
            isEditing={!!editingId}
            onKeyDown={(e, field) => {
              if (e.key === 'Enter') {
                const fields: (keyof SaleForm)[] = ['date', 'mode', 'customerId', 'supplierId', 'sellingPrice', 'costPrice', 'commission', 'notes'];
                const idx = fields.indexOf(field);
                if (idx < fields.length - 1) {
                  // Focus next input (handled by DOM traversal)
                  const formEl = (e.target as HTMLElement).closest('form');
                  if (formEl) {
                    const inputs = formEl.querySelectorAll('input, select');
                    const currentIdx = Array.from(inputs).indexOf(e.target as HTMLInputElement);
                    if (currentIdx < inputs.length - 1) {
                      (inputs[currentIdx + 1] as HTMLElement).focus();
                    }
                  }
                } else {
                  // Last field - save
                  (editingId ? handleUpdate : handleSave)();
                }
              }
            }}
          />
        </div>
      )}

      {/* Bulk entry */}
      {showBulk && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Bulk Entry</h3>
            <button onClick={() => setShowBulk(false)} className="p-1 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-2">
            {bulkForms.map((f, i) => (
              <div key={i} className="border border-slate-200 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">#{i + 1}</span>
                  {bulkForms.length > 1 && (
                    <button
                      onClick={() => {
                        const newForms = bulkForms.filter((_, idx) => idx !== i);
                        setBulkForms(newForms);
                      }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <SaleFormFields
                  form={f}
                  setForm={(updater) => {
                    const newForms = [...bulkForms];
                    newForms[i] = typeof updater === 'function' ? updater(newForms[i]) : updater;
                    setBulkForms(newForms);
                  }}
                  customers={customers}
                  suppliers={suppliers}
                  onSave={() => {}}
                  onCancel={() => {}}
                  saveLabel=""
                  hideActions
                  onKeyDown={(e, field) => {
                    if (e.key === 'Enter') {
                      const fields: (keyof SaleForm)[] = ['date', 'mode', 'customerId', 'supplierId', 'sellingPrice', 'costPrice', 'commission', 'notes'];
                      const idx = fields.indexOf(field);
                      if (idx === fields.length - 1) {
                        // Last field - add new row or save
                        if (i === bulkForms.length - 1) {
                          setBulkForms([...bulkForms, { ...emptyForm, date: todayStr() }]);
                        }
                      }
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-3 pt-3 border-t border-slate-200">
            <button
              onClick={() => setBulkForms([...bulkForms, { ...emptyForm, date: todayStr() }])}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded text-sm font-medium flex items-center gap-1"
            >
              <Plus size={14} /> Add Row
            </button>
            <button onClick={handleBulkSave} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium">
              Save All
            </button>
            <button onClick={() => setShowBulk(false)} className="text-slate-500 hover:text-slate-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sales List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : sortedDates.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No sales found</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedDates.map((date) => {
              const daySales = grouped.get(date) || [];
              const isExpanded = expandedDates.has(date);
              const dayTotal = daySales.reduce((s, sale) => s + (sale.selling_price || 0), 0);
              const dayProfit = daySales.reduce((s, sale) => s + ((sale.selling_price || 0) - (sale.cost_price || 0) - (sale.commission || 0)), 0);

              return (
                <div key={date}>
                  <button
                    onClick={() => {
                      const next = new Set(expandedDates);
                      if (next.has(date)) next.delete(date); else next.add(date);
                      setExpandedDates(next);
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-medium text-slate-800">{formatDate(date)}</span>
                    <span className="text-sm text-slate-500 ml-2">{daySales.length} sales</span>
                    <span className="ml-auto text-sm font-medium text-emerald-600">KES {formatKES(dayTotal)}</span>
                    <span className="text-xs text-slate-400 ml-2">Profit: KES {formatKES(dayProfit)}</span>
                  </button>
                  {isExpanded && (
                    <div className="bg-slate-50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                            <th className="px-4 py-2">ID</th>
                            <th className="px-4 py-2">Mode</th>
                            <th className="px-4 py-2">Description</th>
                            <th className="px-4 py-2 text-right">SP</th>
                            <th className="px-4 py-2 text-right">CP</th>
                            <th className="px-4 py-2 text-right">Profit</th>
                            <th className="px-4 py-2 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {daySales.map((sale) => {
                            const profit = (sale.selling_price || 0) - (sale.cost_price || 0) - (sale.commission || 0);
                            return (
                              <tr key={sale.id} className="hover:bg-white transition-colors">
                                <td className="px-4 py-2 font-mono text-xs text-slate-500">{sale.transaction_id}</td>
                                <td className="px-4 py-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    sale.primary_mode === 'cash' ? 'bg-emerald-100 text-emerald-700' :
                                    sale.primary_mode === 'mpesa' ? 'bg-blue-100 text-blue-700' :
                                    sale.primary_mode === 'paybill' ? 'bg-amber-100 text-amber-700' :
                                    sale.primary_mode === 'credit' ? 'bg-red-100 text-red-700' :
                                    sale.primary_mode === 'advance' ? 'bg-purple-100 text-purple-700' :
                                    'bg-slate-100 text-slate-700'
                                  }`}>
                                    {sale.primary_mode}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {sale.description || '-'}
                                  {sale.edited_at && (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title={`Edited ${formatDate(sale.edited_at)}`}>
                                      Edited
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right font-medium">{formatKES(sale.selling_price || 0)}</td>
                                <td className="px-4 py-2 text-right text-slate-500">{formatKES(sale.cost_price || 0)}</td>
                                <td className={`px-4 py-2 text-right font-medium ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {formatKES(profit)}
                                </td>
                                <td className="px-4 py-2 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <button onClick={() => startEdit(sale)} className="p-1 hover:bg-slate-200 rounded">
                                      <Edit2 size={14} className="text-slate-500" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        const reason = prompt('Enter void reason:');
                                        if (reason) handleVoid(sale.id, reason);
                                      }}
                                      className="p-1 hover:bg-red-100 rounded"
                                    >
                                      <Trash2 size={14} className="text-red-500" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title="Sales Ledger"
        filterTypes={['sale']}
      />
    </div>
  );
}

function SaleFormFields({
  form,
  setForm,
  customers,
  suppliers,
  onSave,
  onCancel,
  saveLabel,
  hideActions,
  showQuickAddCustomer,
  setShowQuickAddCustomer,
  quickCustomer,
  setQuickCustomer,
  onQuickAddCustomer,
  showQuickAddSupplier,
  setShowQuickAddSupplier,
  quickSupplier,
  setQuickSupplier,
  onQuickAddSupplier,
  isEditing,
  onKeyDown,
}: {
  form: SaleForm;
  setForm: React.Dispatch<React.SetStateAction<SaleForm>>;
  customers: Customer[];
  suppliers: Supplier[];
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  hideActions?: boolean;
  showQuickAddCustomer?: boolean;
  setShowQuickAddCustomer?: (v: boolean) => void;
  quickCustomer?: { name: string; phone: string; creditLimit: string };
  setQuickCustomer?: (v: { name: string; phone: string; creditLimit: string }) => void;
  onQuickAddCustomer?: () => void;
  showQuickAddSupplier?: boolean;
  setShowQuickAddSupplier?: (v: boolean) => void;
  quickSupplier?: { name: string; phone: string; balance: string };
  setQuickSupplier?: (v: { name: string; phone: string; balance: string }) => void;
  onQuickAddSupplier?: () => void;
  isEditing?: boolean;
  onKeyDown?: (e: React.KeyboardEvent, field: keyof SaleForm) => void;
}) {
  const sp = parseFloat(form.sellingPrice || '0');
  const cp = parseFloat(form.costPrice || '0');
  const comm = parseFloat(form.commission || '0');
  const profit = sp - cp - comm;

  const update = (field: keyof SaleForm, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, field: keyof SaleForm) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onKeyDown?.(e, field);
    }
  };

  return (
    <div className="space-y-2">
      {/* Row 1: Date, Mode, Customer/Supplier */}
      <div className="grid grid-cols-4 gap-2">
        <input
          type="date"
          value={form.date}
          onChange={(e) => update('date', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'date')}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <select
          value={form.mode}
          onChange={(e) => update('mode', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="cash">Cash</option>
          <option value="mpesa">Mpesa</option>
          <option value="paybill">Paybill</option>
          <option value="split">Split</option>
          <option value="credit">Credit</option>
          <option value="advance">Advance</option>
          <option value="supplier">Supplier</option>
        </select>
        {(form.mode === 'credit' || form.mode === 'advance') && (
          <div className="col-span-2 flex gap-1">
            <select
              value={form.customerId}
              onChange={(e) => update('customerId', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'customerId')}
              className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {setShowQuickAddCustomer && (
              <button
                type="button"
                onClick={() => setShowQuickAddCustomer(!showQuickAddCustomer)}
                className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                title="Add new customer"
              >
                <UserPlus size={16} className="text-slate-500" />
              </button>
            )}
          </div>
        )}
        {form.mode === 'supplier' && (
          <div className="col-span-2 flex gap-1">
            <select
              value={form.supplierId}
              onChange={(e) => update('supplierId', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'supplierId')}
              className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {setShowQuickAddSupplier && (
              <button
                type="button"
                onClick={() => setShowQuickAddSupplier(!showQuickAddSupplier)}
                className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                title="Add new supplier"
              >
                <UserPlus size={16} className="text-slate-500" />
              </button>
            )}
          </div>
        )}
        {form.mode !== 'credit' && form.mode !== 'advance' && form.mode !== 'supplier' && (
          <div className="col-span-2" />
        )}
      </div>

      {/* Inline quick-add customer */}
      {form.mode !== 'supplier' && showQuickAddCustomer && quickCustomer && setQuickCustomer && onQuickAddCustomer && (
        <div className="grid grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
          <input
            type="text"
            value={quickCustomer.name}
            onChange={(e) => setQuickCustomer({ ...quickCustomer, name: e.target.value })}
            placeholder="New customer name"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="text"
            value={quickCustomer.phone}
            onChange={(e) => setQuickCustomer({ ...quickCustomer, phone: e.target.value })}
            placeholder="Phone (optional)"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="number"
            value={quickCustomer.creditLimit}
            onChange={(e) => setQuickCustomer({ ...quickCustomer, creditLimit: e.target.value })}
            placeholder="Credit limit (optional)"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <div className="flex gap-1">
            <button type="button" onClick={onQuickAddCustomer} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">
              Add
            </button>
            <button type="button" onClick={() => setShowQuickAddCustomer && setShowQuickAddCustomer(false)} className="text-slate-500 hover:text-slate-700 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Inline quick-add supplier */}
      {form.mode === 'supplier' && showQuickAddSupplier && quickSupplier && setQuickSupplier && onQuickAddSupplier && (
        <div className="grid grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
          <input
            type="text"
            value={quickSupplier.name}
            onChange={(e) => setQuickSupplier({ ...quickSupplier, name: e.target.value })}
            placeholder="New supplier name"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="text"
            value={quickSupplier.phone}
            onChange={(e) => setQuickSupplier({ ...quickSupplier, phone: e.target.value })}
            placeholder="Phone (optional)"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="number"
            value={quickSupplier.balance}
            onChange={(e) => setQuickSupplier({ ...quickSupplier, balance: e.target.value })}
            placeholder="Opening balance (optional)"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <div className="flex gap-1">
            <button type="button" onClick={onQuickAddSupplier} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">
              Add
            </button>
            <button type="button" onClick={() => setShowQuickAddSupplier && setShowQuickAddSupplier(false)} className="text-slate-500 hover:text-slate-700 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Row 2: SP, CP, Commission */}
      <div className="grid grid-cols-4 gap-2">
        <input
          type="number"
          value={form.sellingPrice}
          onChange={(e) => update('sellingPrice', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'sellingPrice')}
          placeholder="SP (Selling Price)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <input
          type="number"
          value={form.costPrice}
          onChange={(e) => update('costPrice', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'costPrice')}
          placeholder="CP (Cost Price)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <input
          type="number"
          value={form.commission}
          onChange={(e) => update('commission', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'commission')}
          placeholder="Commission"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <select
          value={form.commissionMode}
          onChange={(e) => update('commissionMode', e.target.value)}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="cash">From Cash</option>
          <option value="mpesa">From Mpesa</option>
          <option value="paybill">From Paybill</option>
        </select>
      </div>

      {/* Split amounts if split mode */}
      {form.mode === 'split' && (
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            value={form.splitMpesa}
            onChange={(e) => update('splitMpesa', e.target.value)}
            placeholder="Mpesa"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="number"
            value={form.splitCash}
            onChange={(e) => update('splitCash', e.target.value)}
            placeholder="Cash"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="number"
            value={form.splitPaybill}
            onChange={(e) => update('splitPaybill', e.target.value)}
            placeholder="Paybill"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
      )}

      {/* Advance mode buttons */}
      {form.mode === 'advance' && (
        <div className="flex gap-2">
          {['cash', 'mpesa', 'paybill'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => update('advanceMode', m)}
              className={`px-3 py-1 rounded text-xs font-medium ${
                form.advanceMode === m ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Row 3: Notes */}
      <input
        type="text"
        value={form.notes}
        onChange={(e) => update('notes', e.target.value)}
        onKeyDown={(e) => handleKeyDown(e, 'notes')}
        placeholder="Notes (optional)"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
      />

      {/* Profit display and actions */}
      {!hideActions && (
        <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
          <button
            onClick={onSave}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            {saveLabel || 'Save'}
          </button>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700 text-sm">
            Cancel
          </button>
          <div className="ml-auto text-sm">
            <span className="text-slate-500">Profit: </span>
            <span className={`font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              KES {formatKES(profit)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
