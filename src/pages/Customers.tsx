import { useEffect, useState, Fragment } from 'react';
import {
  Plus,
  Search,
  X,
  Save,
  Phone,
  CreditCard,
  Wallet,
  BookOpen,
  Edit2,
  Trash2,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, todayStr } from '../utils/format';
import { adjustCustomerCredit, adjustCustomerAdvance } from '../utils/balances';
import { insertTransactionWithId } from '../utils/transactionId';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import LedgerModal from '../components/LedgerModal';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Customer, Transaction } from '../types';

interface CustomerForm {
  name: string;
  phone: string;
  creditLimit: string;
  advanceBalance: string;
  openingCredit: string;
  notes: string;
}

interface SaleEditForm {
  date: string;
  sellingPrice: string;
  costPrice: string;
  commission: string;
  commissionMode: string;
  settlementMode: string;
  notes: string;
}

interface PaymentForm {
  amount: string;
  date: string;
  mode: string;
  notes: string;
  paymentType: 'credit' | 'advance';
}

const emptyCustomer: CustomerForm = {
  name: '',
  phone: '',
  creditLimit: '',
  advanceBalance: '',
  openingCredit: '',
  notes: '',
};

const emptySaleEdit: SaleEditForm = {
  date: '',
  sellingPrice: '',
  costPrice: '',
  commission: '',
  commissionMode: 'cash',
  settlementMode: 'cash',
  notes: '',
};

const emptyPayment: PaymentForm = {
  amount: '',
  date: new Date().toISOString().split('T')[0],
  mode: 'cash',
  notes: '',
  paymentType: 'credit',
};

export default function Customers() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<CustomerForm>(emptyCustomer);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPayment);
  const [search, setSearch] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [saleEditForm, setSaleEditForm] = useState<SaleEditForm>(emptySaleEdit);
  const [txnDatePreset, setTxnDatePreset] = useState<DatePreset>('month');
  const [txnCustomFrom, setTxnCustomFrom] = useState('');
  const [txnCustomTo, setTxnCustomTo] = useState('');

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  useEffect(() => {
    if (selectedCustomer) {
      const updated = customers.find((c) => c.id === selectedCustomer.id);
      if (updated) setSelectedCustomer(updated);
    }
  }, [customers]);

  async function fetchData() {
    setLoading(true);
    const [{ data: cust }, { data: txns }] = await Promise.all([
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }),
    ]);
    setCustomers(cust || []);
    setTransactions(txns || []);
    setLoading(false);
    return { cust, txns };
  }

  async function refreshCustomerData() {
    const { cust } = await fetchData();
    if (selectedCustomer && cust) {
      const updated = cust.find((c) => c.id === selectedCustomer.id);
      if (updated) setSelectedCustomer(updated);
    }
    triggerRefresh();
  }

  function openingAdvanceTxnId(customerId: string) {
    return `OPN-ADV-${customerId}`;
  }

  function openingCreditTxnId(customerId: string) {
    return `OPN-CR-${customerId}`;
  }

  async function handleSaveCustomer() {
    if (!form.name.trim()) return;

    const openingAdvance = parseFloat(form.advanceBalance || '0');
    const openingCredit = parseFloat(form.openingCredit || '0');

    const { data: newCustomer, error } = await supabase.from('customers').insert({
      name: form.name.trim(),
      phone: form.phone || null,
      credit_limit: parseFloat(form.creditLimit || '0'),
      advance_balance: openingAdvance,
      credit_balance: openingCredit,
      notes: form.notes || null,
    }).select().single();
    if (error || !newCustomer) { alert('Failed to save customer: ' + (error?.message || 'unknown error')); return; }

    // Mirror nonzero opening balances into transactions so they show up in
    // Reports/the Ledger with a visible origin, and can be edited/deleted later
    if (newCustomer && openingAdvance > 0) {
      await supabase.from('transactions').insert({
        transaction_id: openingAdvanceTxnId(newCustomer.id),
        date: todayStr(),
        type: 'customer_payment',
        primary_mode: null,
        amount: openingAdvance,
        customer_id: newCustomer.id,
        description: `Opening advance - ${newCustomer.name}`,
        created_by: user?.username || null,
      });
    }
    if (newCustomer && openingCredit > 0) {
      await supabase.from('transactions').insert({
        transaction_id: openingCreditTxnId(newCustomer.id),
        date: todayStr(),
        type: 'opening_balance',
        primary_mode: null,
        amount: openingCredit,
        customer_id: newCustomer.id,
        description: `Opening balance owed - ${newCustomer.name}`,
        created_by: user?.username || null,
      });
    }

    setForm(emptyCustomer);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
  }

  async function handleUpdateCustomer() {
    if (!selectedCustomer || !form.name.trim()) return;

    await supabase.from('customers').update({
      name: form.name.trim(),
      phone: form.phone || null,
      credit_limit: parseFloat(form.creditLimit || '0'),
      notes: form.notes || null,
    }).eq('id', selectedCustomer.id);

    // Keep the opening advance in sync by delta, not by overwriting the whole
    // balance - any real advance payments/usage recorded since should not be wiped out.
    // Look up the mirror row directly (not from is_void-filtered state) so a
    // previously-voided row is found and revived instead of re-inserted, which
    // would fail against the transaction_id unique constraint.
    const txnId = openingAdvanceTxnId(selectedCustomer.id);
    const { data: existing } = await supabase.from('transactions').select('*').eq('transaction_id', txnId).maybeSingle();
    const oldOpening = existing && !existing.is_void ? existing.amount || 0 : 0;
    const newOpening = parseFloat(form.advanceBalance || '0');
    const delta = newOpening - oldOpening;

    if (delta !== 0) {
      await adjustCustomerAdvance(selectedCustomer.id, delta);
    }

    if (existing) {
      if (newOpening > 0) {
        await supabase.from('transactions').update({ amount: newOpening, is_void: false, edited_at: new Date().toISOString() }).eq('id', existing.id);
      } else if (!existing.is_void) {
        await supabase.from('transactions').update({ is_void: true, void_reason: 'Opening advance removed' }).eq('id', existing.id);
      }
    } else if (newOpening > 0) {
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: todayStr(),
        type: 'customer_payment',
        primary_mode: null,
        amount: newOpening,
        customer_id: selectedCustomer.id,
        description: `Opening advance - ${form.name.trim()}`,
        created_by: user?.username || null,
      });
    }

    // Same delta-sync pattern for the opening balance owed (credit)
    const creditTxnId = openingCreditTxnId(selectedCustomer.id);
    const { data: existingCredit } = await supabase.from('transactions').select('*').eq('transaction_id', creditTxnId).maybeSingle();
    const oldOpeningCredit = existingCredit && !existingCredit.is_void ? existingCredit.amount || 0 : 0;
    const newOpeningCredit = parseFloat(form.openingCredit || '0');
    const creditDelta = newOpeningCredit - oldOpeningCredit;

    if (creditDelta !== 0) {
      await adjustCustomerCredit(selectedCustomer.id, creditDelta);
    }

    if (existingCredit) {
      if (newOpeningCredit > 0) {
        await supabase.from('transactions').update({ amount: newOpeningCredit, is_void: false, edited_at: new Date().toISOString() }).eq('id', existingCredit.id);
      } else if (!existingCredit.is_void) {
        await supabase.from('transactions').update({ is_void: true, void_reason: 'Opening balance removed' }).eq('id', existingCredit.id);
      }
    } else if (newOpeningCredit > 0) {
      await supabase.from('transactions').insert({
        transaction_id: creditTxnId,
        date: todayStr(),
        type: 'opening_balance',
        primary_mode: null,
        amount: newOpeningCredit,
        customer_id: selectedCustomer.id,
        description: `Opening balance owed - ${form.name.trim()}`,
        created_by: user?.username || null,
      });
    }

    setShowEdit(false);
    fetchData();
    triggerRefresh();
  }

  async function handleDeleteCustomer(id: string) {
    await supabase.from('customers').update({ is_active: false }).eq('id', id);
    if (selectedCustomer?.id === id) setSelectedCustomer(null);
    fetchData();
    triggerRefresh();
  }

  async function handlePayment() {
    if (!selectedCustomer || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0) return;

    const amt = parseFloat(paymentForm.amount);

    const { data: newTxn, error } = await insertTransactionWithId('PAY-' + paymentForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: paymentForm.date,
      type: 'customer_payment',
      primary_mode: paymentForm.mode as any,
      amount: amt,
      customer_id: selectedCustomer.id,
      description: `Payment from ${selectedCustomer.name}`,
      notes: paymentForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save payment: ' + (error?.message || 'unknown error')); return; }

    await adjustCustomerCredit(selectedCustomer.id, -amt);

    setPaymentForm(emptyPayment);
    setShowPayment(false);
    refreshCustomerData();
  }

  async function handleAddAdvance() {
    if (!selectedCustomer || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0) return;

    const amt = parseFloat(paymentForm.amount);

    const { data: newTxn, error } = await insertTransactionWithId('ADV-' + paymentForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: paymentForm.date,
      type: 'customer_payment',
      primary_mode: paymentForm.mode as any,
      amount: amt,
      customer_id: selectedCustomer.id,
      description: `Advance from ${selectedCustomer.name}`,
      notes: paymentForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save advance: ' + (error?.message || 'unknown error')); return; }

    await adjustCustomerAdvance(selectedCustomer.id, amt);

    setPaymentForm(emptyPayment);
    setShowPayment(false);
    refreshCustomerData();
  }

  function getCustomerTransactions(customerId: string) {
    const { from, to } = getDatePresetRange(txnDatePreset, txnCustomFrom, txnCustomTo);
    return transactions.filter((t) => t.customer_id === customerId && t.date >= from && t.date <= to);
  }

  function getCreditSales(customerId: string) {
    return transactions.filter((t) => t.customer_id === customerId && t.type === 'sale' && t.primary_mode === 'credit');
  }

  function getPayments(customerId: string) {
    // Only payments against credit, not advance deposits (those build up
    // advance_balance, a separate pool, not a payment against credit owed)
    return transactions.filter((t) => t.customer_id === customerId && t.type === 'customer_payment'
      && !t.description?.startsWith('Advance from') && !t.transaction_id.startsWith('OPN-ADV-'));
  }

  function getTotalCredit(customerId: string) {
    const openingCredit = transactions.find((t) => t.customer_id === customerId && t.type === 'opening_balance')?.amount || 0;
    return openingCredit + getCreditSales(customerId).reduce((sum, t) => sum + (t.selling_price || 0), 0);
  }

  function getTotalPaid(customerId: string) {
    return getPayments(customerId).reduce((sum, t) => sum + (t.amount || 0), 0);
  }

  function startEditCustomer(c: Customer) {
    setSelectedCustomer(c);
    const opening = transactions.find((t) => t.transaction_id === openingAdvanceTxnId(c.id));
    const openingCredit = transactions.find((t) => t.transaction_id === openingCreditTxnId(c.id));
    setForm({
      name: c.name,
      phone: c.phone || '',
      creditLimit: String(c.credit_limit || ''),
      advanceBalance: String(opening?.amount || 0),
      openingCredit: String(openingCredit?.amount || 0),
      notes: c.notes || '',
    });
    setShowEdit(true);
  }

  function startEditSale(t: Transaction) {
    setEditingSaleId(t.id);
    setSaleEditForm({
      date: t.date,
      sellingPrice: String(t.selling_price || ''),
      costPrice: String(t.cost_price || ''),
      commission: String(t.commission || ''),
      commissionMode: t.commission_mode || 'cash',
      settlementMode: t.settlement_mode || 'cash',
      notes: t.notes || '',
    });
  }

  async function handleUpdateSale() {
    if (!editingSaleId || !selectedCustomer) return;
    const oldTxn = transactions.find((t) => t.id === editingSaleId);
    if (!oldTxn) return;

    const sp = parseFloat(saleEditForm.sellingPrice || '0');
    if (!saleEditForm.sellingPrice || isNaN(sp) || sp <= 0) {
      alert('Enter a valid selling price greater than 0');
      return;
    }
    const cp = parseFloat(saleEditForm.costPrice || '0');
    const comm = parseFloat(saleEditForm.commission || '0');
    const isAdvance = oldTxn.primary_mode === 'advance';

    // Reverse the old effect, then apply the new one as a delta - keeps this
    // correct even if a payment/spend happened on this customer in between.
    if (isAdvance) {
      await adjustCustomerAdvance(selectedCustomer.id, oldTxn.amount || 0);
    } else {
      await adjustCustomerCredit(selectedCustomer.id, -(oldTxn.amount || 0));
    }

    await supabase.from('transactions').update({
      date: saleEditForm.date,
      amount: sp,
      selling_price: sp,
      cost_price: cp || null,
      commission: comm || null,
      commission_mode: comm > 0 ? saleEditForm.commissionMode : null,
      settlement_mode: isAdvance ? saleEditForm.settlementMode : oldTxn.settlement_mode,
      notes: isAdvance
        ? `Advance payment via ${saleEditForm.settlementMode}${saleEditForm.notes ? ' | ' + saleEditForm.notes : ''}`
        : (saleEditForm.notes || null),
      edited_at: new Date().toISOString(),
    }).eq('id', editingSaleId);

    if (isAdvance) {
      await adjustCustomerAdvance(selectedCustomer.id, -sp);
    } else {
      await adjustCustomerCredit(selectedCustomer.id, sp);
    }

    setEditingSaleId(null);
    setSaleEditForm(emptySaleEdit);
    refreshCustomerData();
  }

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { setShowAdd(true); setForm(emptyCustomer); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} /> Add Customer
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
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
      </div>

      {/* Add Customer Modal */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">Add Customer</h3>
            <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
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
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                placeholder="Credit Limit"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="number"
                value={form.openingCredit}
                onChange={(e) => setForm({ ...form, openingCredit: e.target.value })}
                placeholder="Opening Balance Owed"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="number"
                value={form.advanceBalance}
                onChange={(e) => setForm({ ...form, advanceBalance: e.target.value })}
                placeholder="Opening Advance"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveCustomer(); }}}
              placeholder="Notes (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button onClick={handleSaveCustomer} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium">Save</button>
              <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {showEdit && selectedCustomer && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">Edit Customer</h3>
            <button onClick={() => setShowEdit(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
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
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                placeholder="Credit Limit"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="number"
                value={form.openingCredit}
                onChange={(e) => setForm({ ...form, openingCredit: e.target.value })}
                placeholder="Opening Balance Owed"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="number"
                value={form.advanceBalance}
                onChange={(e) => setForm({ ...form, advanceBalance: e.target.value })}
                placeholder="Opening Advance"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUpdateCustomer(); }}}
              placeholder="Notes (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button onClick={handleUpdateCustomer} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium">Update</button>
              <button onClick={() => setShowEdit(false)} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Split Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Customer List */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-1">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Customers ({filteredCustomers.length})</h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-slate-400">Loading...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No customers found</div>
            ) : (
              filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCustomer(c)}
                  className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors ${
                    selectedCustomer?.id === c.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''
                  }`}
                >
                  <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-medium uppercase text-slate-600">
                    {c.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.phone || 'No phone'}</p>
                  </div>
                  <div className="flex gap-1">
                    {(c.credit_balance || 0) > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full" title="Credit Owed">Cr: {formatKES(c.credit_balance)}</span>
                    )}
                    {(c.credit_balance || 0) < 0 && (
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full" title="Shop owes customer">Owed: {formatKES(Math.abs(c.credit_balance))}</span>
                    )}
                    {(c.advance_balance || 0) > 0 && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full" title="Advance Paid">Adv: {formatKES(c.advance_balance)}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Customer Detail */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          {selectedCustomer ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-sm font-medium uppercase text-emerald-700">
                    {selectedCustomer.name[0]}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">{selectedCustomer.name}</h3>
                    <p className="text-xs text-slate-500">{selectedCustomer.phone || 'No phone'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEditCustomer(selectedCustomer)} className="p-1.5 hover:bg-slate-100 rounded">
                    <Edit2 size={14} className="text-slate-500" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this customer?')) handleDeleteCustomer(selectedCustomer.id);
                    }}
                    className="p-1.5 hover:bg-red-100 rounded"
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </button>
                  <button
                    onClick={() => { setShowPayment(true); setPaymentForm({ ...emptyPayment, date: todayStr(), paymentType: 'credit' }); }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                  >
                    Add Payment
                  </button>
                  <button
                    onClick={() => { setShowPayment(true); setPaymentForm({ ...emptyPayment, date: todayStr(), paymentType: 'advance' }); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                  >
                    Add Advance
                  </button>
                </div>
              </div>

              {/* Balance Cards */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className={`rounded-lg p-3 border ${(selectedCustomer.credit_balance || 0) < 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard size={14} className={(selectedCustomer.credit_balance || 0) < 0 ? 'text-emerald-500' : 'text-red-500'} />
                    <span className={`text-xs ${(selectedCustomer.credit_balance || 0) < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(selectedCustomer.credit_balance || 0) < 0 ? 'Shop Owes Customer' : 'Credit Balance'}
                    </span>
                  </div>
                  <p className={`text-lg font-bold ${(selectedCustomer.credit_balance || 0) < 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatKES(Math.abs(selectedCustomer.credit_balance || 0))}
                  </p>
                  {selectedCustomer.credit_limit > 0 && (selectedCustomer.credit_balance || 0) >= 0 && (
                    <div className="w-full bg-red-200 rounded-full h-1.5 mt-1">
                      <div
                        className="bg-red-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, ((selectedCustomer.credit_balance || 0) / selectedCustomer.credit_limit) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                  <div className="flex items-center gap-2 mb-1">
                    <Wallet size={14} className="text-blue-500" />
                    <span className="text-xs text-blue-600">Advance Balance</span>
                  </div>
                  <p className="text-lg font-bold text-blue-700">{formatKES(selectedCustomer.advance_balance || 0)}</p>
                </div>
              </div>

              {/* Credit Summary */}
              <div className="bg-slate-50 rounded-lg p-3 mb-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-slate-500">Total Credit</p>
                    <p className="text-lg font-bold text-red-600">{formatKES(getTotalCredit(selectedCustomer.id))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total Paid</p>
                    <p className="text-lg font-bold text-emerald-600">{formatKES(getTotalPaid(selectedCustomer.id))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Remaining</p>
                    <p className="text-lg font-bold text-slate-800">{formatKES(getTotalCredit(selectedCustomer.id) - getTotalPaid(selectedCustomer.id))}</p>
                  </div>
                </div>
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
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getCustomerTransactions(selectedCustomer.id).length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 text-xs">No transactions</td></tr>
                    ) : (
                      getCustomerTransactions(selectedCustomer.id).map((t) => (
                        <Fragment key={t.id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 text-slate-600">{formatDate(t.date)}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              t.type === 'sale' && t.primary_mode === 'credit' ? 'bg-red-100 text-red-700' :
                              t.type === 'sale' ? 'bg-emerald-100 text-emerald-700' :
                              t.type === 'opening_balance' ? 'bg-red-100 text-red-700' :
                              t.type === 'customer_payment' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {t.type === 'sale' ? (t.primary_mode === 'credit' ? 'Credit Sale' : t.primary_mode === 'advance' ? 'Advance Sale' : 'Sale') : t.type === 'opening_balance' ? 'Opening balance' : t.type.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-xs capitalize">
                            {t.primary_mode === 'advance' && t.settlement_mode ? `advance (${t.settlement_mode})` : (t.primary_mode || '-')}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {t.notes || t.description || '-'}
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
                            t.type === 'sale' ? 'text-emerald-600' : t.type === 'opening_balance' ? 'text-red-600' : 'text-blue-600'
                          }`}>
                            {t.type === 'sale' || t.type === 'opening_balance' ? '+' : '-'}{formatKES(t.type === 'sale' ? (t.selling_price || t.amount) : t.amount)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {t.type === 'sale' && (t.primary_mode === 'credit' || t.primary_mode === 'advance') && (
                              <button onClick={() => startEditSale(t)} className="p-1 hover:bg-slate-200 rounded">
                                <Edit2 size={14} className="text-slate-500" />
                              </button>
                            )}
                          </td>
                        </tr>
                        {editingSaleId === t.id && (
                          <tr>
                            <td colSpan={6} className="px-3 py-3 bg-slate-50">
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                <input
                                  type="date"
                                  value={saleEditForm.date}
                                  onChange={(e) => setSaleEditForm({ ...saleEditForm, date: e.target.value })}
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  value={saleEditForm.sellingPrice}
                                  onChange={(e) => setSaleEditForm({ ...saleEditForm, sellingPrice: e.target.value })}
                                  placeholder="Selling Price"
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <input
                                  type="number"
                                  value={saleEditForm.costPrice}
                                  onChange={(e) => setSaleEditForm({ ...saleEditForm, costPrice: e.target.value })}
                                  placeholder="Cost Price"
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <input
                                  type="number"
                                  value={saleEditForm.commission}
                                  onChange={(e) => setSaleEditForm({ ...saleEditForm, commission: e.target.value })}
                                  placeholder="Commission"
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <select
                                  value={saleEditForm.commissionMode}
                                  onChange={(e) => setSaleEditForm({ ...saleEditForm, commissionMode: e.target.value })}
                                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                >
                                  <option value="cash">Commission: Cash</option>
                                  <option value="mpesa">Commission: Mpesa</option>
                                  <option value="paybill">Commission: Paybill</option>
                                </select>
                                {t.primary_mode === 'advance' && (
                                  <select
                                    value={saleEditForm.settlementMode}
                                    onChange={(e) => setSaleEditForm({ ...saleEditForm, settlementMode: e.target.value })}
                                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                  >
                                    <option value="cash">Settled via Cash</option>
                                    <option value="mpesa">Settled via Mpesa</option>
                                    <option value="paybill">Settled via Paybill</option>
                                  </select>
                                )}
                                <input
                                  type="text"
                                  value={saleEditForm.notes}
                                  onChange={(e) => setSaleEditForm({ ...saleEditForm, notes: e.target.value })}
                                  placeholder="Notes"
                                  className="col-span-2 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button onClick={handleUpdateSale} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">Save</button>
                                <button onClick={() => { setEditingSaleId(null); setSaleEditForm(emptySaleEdit); }} className="text-slate-500 hover:text-slate-700 text-xs">Cancel</button>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400">Select a customer to view details</div>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && selectedCustomer && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Payment - {selectedCustomer.name}</h3>
              <button onClick={() => setShowPayment(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('#paymentDate') as HTMLElement)?.focus(); }}}
                  placeholder="Amount"
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <select
                  value={paymentForm.paymentType}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentType: e.target.value as 'credit' | 'advance' })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="credit">Pay Credit</option>
                  <option value="advance">Add Advance</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  id="paymentDate"
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
              <input
                type="text"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); paymentForm.paymentType === 'credit' ? handlePayment() : handleAddAdvance(); }}}
                placeholder="Notes (optional)"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <div className="flex gap-2 pt-2 border-t border-slate-200">
                <button onClick={paymentForm.paymentType === 'credit' ? handlePayment : handleAddAdvance} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded text-sm font-medium">
                  {paymentForm.paymentType === 'credit' ? 'Record Payment' : 'Add Advance'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title="Customer Ledger"
        filterTypes={['sale', 'customer_payment', 'opening_balance']}
      />
    </div>
  );
}