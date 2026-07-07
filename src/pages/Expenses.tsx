import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  X,
  Save,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Settings,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, todayStr } from '../utils/format';
import { adjustSupplierBalance, adjustLoanBalance } from '../utils/balances';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import LedgerModal from '../components/LedgerModal';
import type { Transaction, Supplier, LoanTracker, ExpenseCategory } from '../types';

interface ExpenseForm {
  date: string;
  category: string;
  amount: string;
  mode: string;
  description: string;
  notes: string;
  supplierId: string;
  loanId: string;
  partnerId: string;
  source: 'shop' | 'own_pocket';
}

const emptyForm: ExpenseForm = {
  date: new Date().toISOString().split('T')[0],
  category: '',
  amount: '',
  mode: 'cash',
  description: '',
  notes: '',
  supplierId: '',
  loanId: '',
  partnerId: '',
  source: 'shop',
};

export default function Expenses() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'shop' | 'home' | 'loans' | 'suppliers'>('shop');
  const [expenses, setExpenses] = useState<Transaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loans, setLoans] = useState<LoanTracker[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab, refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: suppData }, { data: loanData }, { data: catData }, { data: suppPayments }, { data: loanPayments }] = await Promise.all([
      supabase.from('transactions').select('*').eq('type', 'expense').order('date', { ascending: false }),
      supabase.from('suppliers').select('*').eq('is_active', true),
      supabase.from('loan_trackers').select('*'),
      supabase.from('expense_categories').select('*').eq('is_active', true).order('name'),
      supabase.from('transactions').select('*').eq('type', 'supplier_payment').order('date', { ascending: false }),
      supabase.from('transactions').select('*').eq('type', 'loan_payment').order('date', { ascending: false }),
    ]);

    let filtered = txns || [];
    if (activeTab === 'shop') {
      filtered = filtered.filter((t) => t.category !== 'home_expense');
    } else if (activeTab === 'home') {
      filtered = filtered.filter((t) => t.category === 'home_expense');
    } else if (activeTab === 'loans') {
      // Show both expense with loan category and loan_payment type
      const loanExpenses = filtered.filter((t) => {
        const cat = t.category || '';
        return cat.includes('loan') || t.loan_id;
      });
      filtered = [...loanExpenses, ...(loanPayments || [])];
    } else if (activeTab === 'suppliers') {
      filtered = suppPayments || [];
    }

    setExpenses(filtered);
    setSuppliers(suppData || []);
    setLoans(loanData || []);
    setExpenseCategories(catData || []);
    setLoading(false);
  }

  async function handleSaveCategory() {
    if (!newCategoryName.trim()) return;
    await supabase.from('expense_categories').insert({
      name: newCategoryName.trim().toLowerCase().replace(/\s+/g, '_'),
      description: newCategoryDesc || null,
    });
    setNewCategoryName('');
    setNewCategoryDesc('');
    fetchData();
  }

  async function handleDeleteCategory(id: string) {
    await supabase.from('expense_categories').update({ is_active: false }).eq('id', id);
    fetchData();
  }

  async function getNextTransactionId(date: string, type: string = 'EXP'): Promise<string> {
    const prefix = type + '-' + date.replace(/-/g, '');
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

  async function handleSave() {
    if (!form.amount || parseFloat(form.amount) <= 0) return;

    const amt = parseFloat(form.amount);

    // Handle supplier payment separately
    if (activeTab === 'suppliers') {
      if (!form.supplierId) return;
      const supp = suppliers.find((s) => s.id === form.supplierId);
      if (!supp) return;

      const txnId = await getNextTransactionId(form.date, 'SUP');
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: form.date,
        type: 'supplier_payment',
        primary_mode: form.mode,
        amount: amt,
        supplier_id: form.supplierId,
        description: form.description || `Payment to ${supp.name}`,
        notes: form.notes || null,
        created_by: user?.username || null,
      });
      await adjustSupplierBalance(form.supplierId, -amt);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    // Handle loan payment separately
    if (activeTab === 'loans') {
      if (!form.loanId) return;
      const loan = loans.find((l) => l.id === form.loanId);
      if (!loan) return;

      const txnId = await getNextTransactionId(form.date, 'LOAN');
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: form.date,
        type: 'loan_payment',
        primary_mode: form.mode,
        amount: amt,
        loan_id: form.loanId,
        description: form.description || `Payment for ${loan.loan_name}`,
        notes: form.notes || null,
        created_by: user?.username || null,
      });
      // Update loan balance
      await adjustLoanBalance(form.loanId, amt);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    const txnId = await getNextTransactionId(form.date);

    const isHomeExpense = activeTab === 'home';
    const category = isHomeExpense ? 'home_expense' : form.category;

    // Check if partner expense category
    const isPartnerExpense = category === 'taher' || category === 'abdulqadir';

    const txnData: any = {
      transaction_id: txnId,
      date: form.date,
      type: isPartnerExpense ? 'partner_draw' : 'expense',
      primary_mode: form.mode,
      amount: amt,
      category,
      description: form.description || null,
      notes: isHomeExpense ? `From ${form.source === 'own_pocket' ? 'Own Pocket' : 'Shop'}${form.notes ? ' | ' + form.notes : ''}` : (form.notes || null),
      supplier_id: form.supplierId || null,
      loan_id: form.loanId || null,
      partner_id: isPartnerExpense ? category : (isHomeExpense ? form.partnerId || null : null),
      created_by: user?.username || null,
    };

    const { data: newTxn, error } = await supabase.from('transactions').insert(txnData).select().single();
    if (error) { console.error(error); return; }

    // Update supplier balance
    if (form.supplierId && (category === 'supplier_payment' || category === 'stock')) {
      await adjustSupplierBalance(form.supplierId, -amt);
    }

    // Update loan balance
    if (form.loanId) {
      const loan = loans.find((l) => l.id === form.loanId);
      if (loan) {
        await adjustLoanBalance(form.loanId, amt);
      }
    }

    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
  }

  async function handleVoid(id: string, reason: string) {
    const txn = expenses.find((e) => e.id === id);
    if (!txn) return;

    // Reverse supplier balance - covers a supplier-payment TYPE transaction (paid via
    // the Suppliers tab) as well as a stock/supplier_payment CATEGORY expense
    if (txn.supplier_id && (txn.type === 'supplier_payment' || txn.category === 'supplier_payment' || txn.category === 'stock')) {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
    }

    // Reverse loan balance
    if (txn.loan_id) {
      await adjustLoanBalance(txn.loan_id, -(txn.amount || 0));
    }

    await supabase.from('transactions').update({ is_void: true, void_reason: reason }).eq('id', id);
    fetchData();
    triggerRefresh();
  }

  function startEdit(expense: Transaction) {
    setEditingId(expense.id);
    const isHome = expense.category === 'home_expense';
    const isPartner = expense.type === 'partner_draw';
    const source = expense.notes?.includes('From Own Pocket') ? 'own_pocket' : 'shop';
    setForm({
      date: expense.date,
      category: isPartner ? (expense.partner_id || '') : (expense.category || ''),
      amount: String(expense.amount),
      mode: expense.primary_mode || 'cash',
      description: expense.description || '',
      notes: isHome ? (expense.notes?.replace(/From (Own Pocket|Shop)( \| )?/, '') || '') : (expense.notes || ''),
      supplierId: expense.supplier_id || '',
      loanId: expense.loan_id || '',
      partnerId: expense.partner_id || '',
      source: source as 'shop' | 'own_pocket',
    });
    if (expense.type === 'supplier_payment') setActiveTab('suppliers');
    else if (expense.type === 'loan_payment') setActiveTab('loans');
    else if (isHome) setActiveTab('home');
    else setActiveTab('shop');
    setShowAdd(true);
  }

  async function handleUpdate() {
    if (!editingId) return;
    const oldTxn = expenses.find((e) => e.id === editingId);
    if (!oldTxn) return;

    const amt = parseFloat(form.amount);

    // Supplier payment and loan payment are their own transaction types - edit them
    // in place instead of falling through to the generic expense path below, which
    // would otherwise overwrite `type` with 'expense' and corrupt the record.
    if (oldTxn.type === 'supplier_payment') {
      if (oldTxn.supplier_id) await adjustSupplierBalance(oldTxn.supplier_id, oldTxn.amount || 0);
      await supabase.from('transactions').update({
        date: form.date,
        primary_mode: form.mode,
        amount: amt,
        supplier_id: form.supplierId || null,
        description: form.description || null,
        notes: form.notes || null,
        edited_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (form.supplierId) await adjustSupplierBalance(form.supplierId, -amt);

      setEditingId(null);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    if (oldTxn.type === 'loan_payment') {
      if (oldTxn.loan_id) await adjustLoanBalance(oldTxn.loan_id, -(oldTxn.amount || 0));
      await supabase.from('transactions').update({
        date: form.date,
        primary_mode: form.mode,
        amount: amt,
        loan_id: form.loanId || null,
        description: form.description || null,
        notes: form.notes || null,
        edited_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (form.loanId) await adjustLoanBalance(form.loanId, amt);

      setEditingId(null);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    const isHomeExpense = activeTab === 'home';
    const category = isHomeExpense ? 'home_expense' : form.category;
    const isPartnerExpense = category === 'taher' || category === 'abdulqadir';

    // Reverse old effects
    if (oldTxn.supplier_id && (oldTxn.category === 'supplier_payment' || oldTxn.category === 'stock')) {
      await adjustSupplierBalance(oldTxn.supplier_id, oldTxn.amount || 0);
    }
    if (oldTxn.loan_id) {
      await adjustLoanBalance(oldTxn.loan_id, -(oldTxn.amount || 0));
    }

    // Update transaction
    await supabase.from('transactions').update({
      date: form.date,
      primary_mode: form.mode,
      amount: amt,
      category,
      description: form.description || null,
      notes: isHomeExpense ? `From ${form.source === 'own_pocket' ? 'Own Pocket' : 'Shop'}${form.notes ? ' | ' + form.notes : ''}` : (form.notes || null),
      supplier_id: form.supplierId || null,
      loan_id: form.loanId || null,
      partner_id: isPartnerExpense ? category : (isHomeExpense ? form.partnerId || null : null),
      type: isPartnerExpense ? 'partner_draw' : 'expense',
      edited_at: new Date().toISOString(),
    }).eq('id', editingId);

    // Apply new effects
    if (form.supplierId && (category === 'supplier_payment' || category === 'stock')) {
      await adjustSupplierBalance(form.supplierId, -amt);
    }
    if (form.loanId) {
      await adjustLoanBalance(form.loanId, amt);
    }

    setEditingId(null);
    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
  }

  const grouped = new Map<string, Transaction[]>();
  const filtered = expenses.filter((e) => {
    if (e.is_void) return false;
    if (search && !e.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && e.category !== filterCategory) return false;
    return true;
  });

  filtered.forEach((e) => {
    if (!grouped.has(e.date)) grouped.set(e.date, []);
    grouped.get(e.date)!.push(e);
  });

  const sortedDates = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));
  const shopCategories = expenseCategories.filter((c) => c.name !== 'home_expense');
  // 'stock' and 'supplier_payment' are excluded from the Shop tab's own
  // category picker - selecting them here has no supplier to attach the
  // payment to, so the amount would never reduce a supplier balance or show
  // up anywhere. Use the dedicated "Supplier Payments" tab for those instead.
  const shopSelectableCategories = shopCategories.filter((c) => c.name !== 'stock' && c.name !== 'supplier_payment');

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit flex-wrap">
        {(['shop', 'home', 'suppliers', 'loans'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setShowAdd(false); setEditingId(null); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'shop' ? 'Shop Expenses' : tab === 'home' ? 'Home Expenses' : tab === 'suppliers' ? 'Supplier Payments' : 'Loans'}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { setShowAdd(true); setEditingId(null); setForm({ ...emptyForm, date: todayStr(), partnerId: user?.username === 'taher' ? 'taher' : user?.username === 'abdulqadir' ? 'abdulqadir' : '' }); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} /> Add {activeTab === 'shop' ? 'Expense' : activeTab === 'home' ? 'Home Expense' : activeTab === 'suppliers' ? 'Supplier Payment' : 'Loan Payment'}
        </button>
        {activeTab === 'shop' && (
          <button
            onClick={() => setShowCategoryManager(!showCategoryManager)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Settings size={16} /> Categories
          </button>
        )}
        <button
          onClick={() => setShowLedger(true)}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Category Manager */}
      {showCategoryManager && activeTab === 'shop' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-semibold text-slate-800 mb-3">Manage Expense Categories</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {shopCategories.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-sm">
                {c.name.replace('_', ' ')}
                <button onClick={() => handleDeleteCategory(c.id)} className="text-red-500 hover:text-red-700"><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-slate-700 mb-1">Category Name</label>
              <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. marketing" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <input type="text" value={newCategoryDesc} onChange={(e) => setNewCategoryDesc(e.target.value)} placeholder="Optional" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <button onClick={handleSaveCategory} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Add</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
        {activeTab === 'shop' && (
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          >
            <option value="">All Categories</option>
            {shopSelectableCategories.map((c) => <option key={c.id} value={c.name}>{c.name.replace('_', ' ')}</option>)}
          </select>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">
              {editingId ? 'Edit' : 'Add'} {activeTab === 'shop' ? 'Expense' : activeTab === 'home' ? 'Home Expense' : activeTab === 'suppliers' ? 'Supplier Payment' : 'Loan Payment'}
            </h3>
            <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="p-1 hover:bg-slate-100 rounded">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-2">
            {/* Row 1: Date, Amount, Mode */}
            <div className="grid grid-cols-3 gap-2">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="Amount"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="cash">Cash</option>
                <option value="mpesa">Mpesa</option>
                <option value="paybill">Paybill</option>
              </select>
            </div>

            {/* Row 2: Category/Loan/Supplier/Partner based on tab */}
            {activeTab === 'shop' && (
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Category</option>
                {shopSelectableCategories.map((c) => <option key={c.id} value={c.name}>{c.name.replace('_', ' ')}</option>)}
              </select>
            )}

            {activeTab === 'home' && (
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={form.partnerId}
                  onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">Partner</option>
                  <option value="taher">Taher</option>
                  <option value="abdulqadir">Abdulqadir</option>
                </select>
                <select
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value as 'shop' | 'own_pocket' })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="shop">From Shop</option>
                  <option value="own_pocket">Own Pocket</option>
                </select>
              </div>
            )}

            {activeTab === 'loans' && (
              <select
                value={form.loanId}
                onChange={(e) => setForm({ ...form, loanId: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Select Loan</option>
                {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_name} ({formatKES(l.remaining_balance)})</option>)}
              </select>
            )}

            {activeTab === 'suppliers' && (
              <select
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatKES(s.balance)})</option>)}
              </select>
            )}

            {/* Description */}
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />

            {/* Notes */}
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (editingId ? handleUpdate : handleSave)();
                }
              }}
              placeholder="Notes (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button
                onClick={editingId ? handleUpdate : handleSave}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium"
              >
                {editingId ? 'Update' : 'Save'}
              </button>
              <button
                onClick={() => { setShowAdd(false); setEditingId(null); }}
                className="text-slate-500 hover:text-slate-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loans Summary */}
      {activeTab === 'loans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loans.map((loan) => {
            const progress = loan.total_amount > 0 ? Math.min(100, ((loan.total_amount - loan.remaining_balance) / loan.total_amount) * 100) : 0;
            return (
              <div key={loan.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-800">{loan.loan_name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${loan.status === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {loan.status}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Total:</span>
                    <span className="font-medium">KES {formatKES(loan.total_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Remaining:</span>
                    <span className="font-medium text-red-600">KES {formatKES(loan.remaining_balance)}</span>
                  </div>
                  {loan.monthly_installment && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Monthly:</span>
                      <span className="font-medium">KES {formatKES(loan.monthly_installment)}</span>
                    </div>
                  )}
                  <div className="w-full bg-slate-200 rounded-full h-2 mt-2">
                    <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 text-right">{progress.toFixed(1)}% paid</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expenses List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : sortedDates.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No expenses found</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedDates.map((date) => {
              const dayExpenses = grouped.get(date) || [];
              const isExpanded = expandedDates.has(date);
              const dayTotal = dayExpenses.reduce((s, e) => s + e.amount, 0);

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
                    <span className="text-sm text-slate-500 ml-2">{dayExpenses.length} entries</span>
                    <span className="ml-auto text-sm font-medium text-red-600">KES {formatKES(dayTotal)}</span>
                  </button>
                  {isExpanded && (
                    <div className="bg-slate-50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                            <th className="px-4 py-2">ID</th>
                            <th className="px-4 py-2">Category</th>
                            <th className="px-4 py-2">Description</th>
                            <th className="px-4 py-2">Mode</th>
                            <th className="px-4 py-2 text-right">Amount</th>
                            <th className="px-4 py-2 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dayExpenses.map((exp) => (
                            <tr key={exp.id} className="hover:bg-white transition-colors">
                              <td className="px-4 py-2 font-mono text-xs text-slate-500">{exp.transaction_id}</td>
                              <td className="px-4 py-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  exp.type === 'partner_draw' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {(exp.category || 'misc').replace('_', ' ')}
                                  {exp.type === 'partner_draw' && ' (Partner)'}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-slate-700">
                                {exp.description || '-'}
                                {exp.created_by && (
                                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Added by">
                                    {exp.created_by}
                                  </span>
                                )}
                                {exp.edited_at && (
                                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title={`Edited ${formatDate(exp.edited_at)}`}>
                                    Edited
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-slate-500">{exp.primary_mode}</td>
                              <td className="px-4 py-2 text-right font-medium text-red-600">{formatKES(exp.amount)}</td>
                              <td className="px-4 py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => startEdit(exp)} className="p-1 hover:bg-slate-200 rounded">
                                    <Edit2 size={14} className="text-slate-500" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      const reason = prompt('Enter void reason:');
                                      if (reason) handleVoid(exp.id, reason);
                                    }}
                                    className="p-1 hover:bg-red-100 rounded"
                                  >
                                    <Trash2 size={14} className="text-red-500" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
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
        title="Expenses Ledger"
        filterTypes={['expense', 'partner_draw']}
      />
    </div>
  );
}