import { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Filter,
  Download,
  Calendar,
  Printer,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, getMonthLabel, saleProfit, isSaleIncomplete } from '../utils/format';
import { sortCustomersByBalance, sortSuppliersByBalance } from '../utils/sortEntities';
import { useDataRefresh } from '../context/DataContext';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Transaction, Customer, Supplier, ExpenseCategory } from '../types';

interface ReportFilters {
  datePreset: DatePreset;
  customFrom: string;
  customTo: string;
  fromDate: string;
  toDate: string;
  entityType: string;
  customerId: string;
  supplierId: string;
  expenseCategory: string;
  paymentMode: string;
}

const emptyFilters: ReportFilters = {
  datePreset: 'month',
  customFrom: '',
  customTo: '',
  fromDate: '',
  toDate: '',
  entityType: 'all',
  customerId: '',
  supplierId: '',
  expenseCategory: '',
  paymentMode: '',
};

const entityTypes = [
  { value: 'all', label: 'All Transactions' },
  { value: 'cash_received', label: 'Cash Received' },
  { value: 'cash_spent', label: 'Cash Spent' },
  { value: 'mpesa_received', label: 'Mpesa Received' },
  { value: 'mpesa_spent', label: 'Mpesa Spent' },
  { value: 'paybill_received', label: 'Paybill Received' },
  { value: 'paybill_spent', label: 'Paybill Spent' },
  { value: 'sales', label: 'Sales' },
  { value: 'customers', label: 'Customers' },
  { value: 'suppliers', label: 'Suppliers' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'shop_expenses', label: 'Shop Expenses' },
  { value: 'home_expenses', label: 'Home Expenses' },
  { value: 'partner_withdrawals', label: 'Partner Withdrawals' },
  { value: 'loans', label: 'Loans' },
  { value: 'profit', label: 'Profit' },
];

export default function Reports() {
  const { refreshKey } = useDataRefresh();
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [monthlyProfit, setMonthlyProfit] = useState<any[]>([]);
  const [physicalCounts, setPhysicalCounts] = useState<{ id: string; month: string; mpesa_actual: number; cash_actual: number; paybill_actual: number; mpesa_system: number; cash_system: number; paybill_system: number }[]>([]);
  const [editingCountId, setEditingCountId] = useState<string | null>(null);
  const [editCountForm, setEditCountForm] = useState({ mpesa: '', cash: '', paybill: '' });

  useEffect(() => {
    fetchReferenceData();
    applyDatePreset('month', '', '');
  }, []);

  useEffect(() => {
    supabase.from('physical_cash_counts').select('*').order('month', { ascending: false }).then(({ data }) => {
      setPhysicalCounts(data || []);
    });
  }, [refreshKey]);

  useEffect(() => {
    if (filters.fromDate && filters.toDate) {
      fetchData();
    }
  }, [filters, refreshKey]);

  async function fetchReferenceData() {
    const [{ data: c }, { data: s }, { data: ec }] = await Promise.all([
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('expense_categories').select('*').eq('is_active', true).order('name'),
    ]);
    setCustomers(c || []);
    setSuppliers(s || []);
    setExpenseCategories(ec || []);
  }

  function startEditCount(c: { id: string; mpesa_actual: number; cash_actual: number; paybill_actual: number }) {
    setEditingCountId(c.id);
    setEditCountForm({ mpesa: String(c.mpesa_actual), cash: String(c.cash_actual), paybill: String(c.paybill_actual) });
  }

  async function handleUpdateCount() {
    if (!editingCountId) return;
    await supabase.from('physical_cash_counts').update({
      mpesa_actual: parseFloat(editCountForm.mpesa || '0'),
      cash_actual: parseFloat(editCountForm.cash || '0'),
      paybill_actual: parseFloat(editCountForm.paybill || '0'),
    }).eq('id', editingCountId);
    setEditingCountId(null);
    const { data } = await supabase.from('physical_cash_counts').select('*').order('month', { ascending: false });
    setPhysicalCounts(data || []);
  }

  function applyDatePreset(preset: DatePreset, customFrom: string, customTo: string) {
    const { from, to } = getDatePresetRange(preset, customFrom, customTo);
    setFilters((f) => ({ ...f, datePreset: preset, customFrom, customTo, fromDate: from, toDate: to }));
  }

  async function fetchData() {
    setLoading(true);
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('is_void', false)
      .gte('date', filters.fromDate)
      .lte('date', filters.toDate)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // Apply entity type filter
    if (filters.entityType !== 'all') {
      switch (filters.entityType) {
        case 'cash_received':
          query = query.in('type', ['sale', 'customer_payment', 'partner_loan', 'opening_balance']).eq('primary_mode', 'cash');
          break;
        case 'cash_spent':
          query = query.in('type', ['expense', 'supplier_payment', 'partner_draw', 'loan_payment']).eq('primary_mode', 'cash');
          break;
        case 'mpesa_received':
          query = query.in('type', ['sale', 'customer_payment', 'partner_loan', 'opening_balance']).eq('primary_mode', 'mpesa');
          break;
        case 'mpesa_spent':
          query = query.in('type', ['expense', 'supplier_payment', 'partner_draw', 'loan_payment']).eq('primary_mode', 'mpesa');
          break;
        case 'paybill_received':
          query = query.in('type', ['sale', 'customer_payment', 'partner_loan', 'opening_balance']).eq('primary_mode', 'paybill');
          break;
        case 'paybill_spent':
          query = query.in('type', ['expense', 'supplier_payment', 'partner_draw', 'loan_payment']).eq('primary_mode', 'paybill');
          break;
        case 'sales':
          query = query.eq('type', 'sale');
          break;
        case 'customers':
          query = query.not('customer_id', 'is', null);
          break;
        case 'suppliers':
          query = query.not('supplier_id', 'is', null);
          break;
        case 'expenses':
          query = query.eq('type', 'expense');
          break;
        case 'shop_expenses':
          query = query.eq('type', 'expense').neq('category', 'home_expense');
          break;
        case 'home_expenses':
          query = query.eq('type', 'expense').eq('category', 'home_expense');
          break;
        case 'partner_withdrawals':
          query = query.eq('type', 'partner_draw');
          break;
        case 'loans':
          query = query.eq('type', 'loan_payment');
          break;
        case 'profit':
          query = query.eq('type', 'sale');
          break;
      }
    }

    if (filters.customerId) query = query.eq('customer_id', filters.customerId);
    if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId);
    if (filters.expenseCategory) query = query.eq('category', filters.expenseCategory);
    if (filters.paymentMode) query = query.eq('primary_mode', filters.paymentMode);

    const { data: txns } = await query;
    const { data: splitData } = await supabase.from('transaction_splits').select('*');

    setTransactions(txns || []);
    setSplits(splitData || []);

    // Fetch monthly profit data for the period
    await fetchMonthlyProfit();
    setLoading(false);
  }

  async function fetchMonthlyProfit() {
    const { data } = await supabase
      .from('historical_profit')
      .select('*')
      .gte('month', filters.fromDate.slice(0, 7))
      .lte('month', filters.toDate.slice(0, 7))
      .order('month', { ascending: false });
    setMonthlyProfit(data || []);
  }

  const splitMap = useMemo(() => {
    const m = new Map<string, { mode: string; amount: number }[]>();
    splits.forEach((s) => {
      if (!m.has(s.transaction_id)) m.set(s.transaction_id, []);
      m.get(s.transaction_id)!.push(s);
    });
    return m;
  }, [splits]);

  const filteredTransactions = useMemo(() => {
    return transactions;
  }, [transactions]);

  const summary = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let salesTotal = 0;
    let grossProfitTotal = 0;
    let commissionTotal = 0;
    let expenseTotal = 0;
    let shopExpenseTotal = 0;
    let homeExpenseTotal = 0;
    let partnerDrawTotal = 0;
    let supplierPaymentTotal = 0;
    let loanPaymentTotal = 0;
    let customerCollectionTotal = 0;

    transactions.forEach((t) => {
      if (t.type === 'sale') {
        // Advance-mode sales don't bring in new cash - that was already
        // counted as "in" when the advance was deposited (a customer_payment),
        // so counting the settlement here too would double it.
        if (t.primary_mode !== 'advance') totalIn += t.amount;
        salesTotal += t.selling_price || t.amount;
        grossProfitTotal += saleProfit(t);
        commissionTotal += t.commission || 0;
      } else if (t.type === 'customer_payment') {
        totalIn += t.amount;
        customerCollectionTotal += t.amount;
      } else if (t.type === 'opening_balance') {
        totalIn += t.amount;
      } else if (t.type === 'expense') {
        totalOut += t.amount;
        expenseTotal += t.amount;
        // Stock/supplier payments made via the expense form are not shop overhead expenses
        const isSupplierPayment = t.category === 'supplier_payment' || t.category === 'stock';
        if (t.category === 'home_expense') {
          // Only the shop's own reimbursement ("From Shop") is a real shop
          // expense - the original "From Own Pocket" entry is the partner's
          // own money, counted once (here) instead of twice.
          if (t.notes?.includes('From Shop')) homeExpenseTotal += t.amount;
        } else if (!isSupplierPayment) shopExpenseTotal += t.amount;
      } else if (t.type === 'supplier_payment') {
        totalOut += t.amount;
        supplierPaymentTotal += t.amount;
      } else if (t.type === 'partner_draw') {
        totalOut += t.amount;
        partnerDrawTotal += t.amount;
      } else if (t.type === 'loan_payment') {
        totalOut += t.amount;
        loanPaymentTotal += t.amount;
      } else if (t.type === 'partner_loan' || t.type === 'capital_entry') {
        // Money a partner puts into (or returns to) the shop
        totalIn += t.amount;
      }
      // supplier_invoice is a new debt owed, not cash leaving the shop - the
      // real cash out is the supplier_payment when it's actually paid, so
      // adding both here would count the same money leaving twice.
    });

    // grossProfitTotal already treats a sale with no cost price yet as 0
    // profit (see saleProfit()) instead of the full selling price. Cost of
    // Goods is derived backward so it stays consistent with that.
    const grossProfit = grossProfitTotal;
    const costTotal = salesTotal - commissionTotal - grossProfit;
    // Partner draws are money partners take out of already-earned profit,
    // not a business expense - excluded here to match Dashboard/Profit & Loss.
    const netProfit = grossProfit - shopExpenseTotal - homeExpenseTotal - loanPaymentTotal;

    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      salesTotal,
      costTotal,
      grossProfit,
      expenseTotal,
      shopExpenseTotal,
      homeExpenseTotal,
      partnerDrawTotal,
      supplierPaymentTotal,
      loanPaymentTotal,
      customerCollectionTotal,
      netProfit,
    };
  }, [transactions]);

  function getModeDisplay(txn: Transaction) {
    if (txn.primary_mode === 'split') {
      const s = splitMap.get(txn.transaction_id) || [];
      if (s.length === 0) return 'Split';
      return s.map((sp) => `${sp.mode}: ${formatKES(sp.amount)}`).join(', ');
    }
    return txn.primary_mode || '-';
  }

  function getEntityName(txn: Transaction) {
    if (txn.customer_id) {
      const c = customers.find((x) => x.id === txn.customer_id);
      return c?.name || 'Customer';
    }
    if (txn.supplier_id) {
      const s = suppliers.find((x) => x.id === txn.supplier_id);
      return s?.name || 'Supplier';
    }
    if (txn.partner_id) return txn.partner_id.charAt(0).toUpperCase() + txn.partner_id.slice(1);
    return '-';
  }

  function getDebitCredit(txn: Transaction) {
    if (txn.type === 'sale' && txn.primary_mode === 'advance') {
      // No new cash moved - already counted when the advance was deposited.
      return { debit: 0, credit: 0 };
    }
    if (txn.type === 'sale' || txn.type === 'customer_payment' || txn.type === 'partner_loan' || txn.type === 'capital_entry' || txn.type === 'opening_balance') {
      // A refund is a sale with a negative amount - real money going back
      // out, so it belongs in Debit, not a negative (and invisible) Credit.
      return txn.amount < 0 ? { debit: -txn.amount, credit: 0 } : { debit: 0, credit: txn.amount };
    }
    if (txn.type === 'expense' || txn.type === 'supplier_payment' || txn.type === 'partner_draw' || txn.type === 'loan_payment' || txn.type === 'supplier_invoice') {
      return { debit: txn.amount, credit: 0 };
    }
    if (txn.type === 'fund_transfer') {
      return { debit: txn.amount, credit: 0 };
    }
    return { debit: 0, credit: 0 };
  }

  function exportCSV() {
    const headers = ['Date', 'ID', 'Type', 'Description', 'Entity', 'Mode', 'Debit', 'Credit'];
    const rows = filteredTransactions.map((t) => {
      const dc = getDebitCredit(t);
      return [
        t.date,
        t.transaction_id,
        t.type,
        t.description || '',
        getEntityName(t),
        getModeDisplay(t),
        dc.debit,
        dc.credit,
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${filters.fromDate}-to-${filters.toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <FileText size={24} className="text-emerald-600" />
          Reports
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Download size={16} /> Export CSV
          </button>
          <button
            onClick={printReport}
            className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      {/* Cash Reconciliation - physical count vs what the system calculated */}
      {physicalCounts.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="font-semibold text-slate-800 mb-3">Cash Reconciliation</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2 text-right">System Said</th>
                  <th className="px-3 py-2 text-right">You Counted</th>
                  <th className="px-3 py-2 text-right">Difference</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {physicalCounts.map((c) => {
                  const modes: { label: string; system: number; actual: number }[] = [
                    { label: 'Mpesa', system: c.mpesa_system, actual: c.mpesa_actual },
                    { label: 'Cash', system: c.cash_system, actual: c.cash_actual },
                    { label: 'Paybill', system: c.paybill_system, actual: c.paybill_actual },
                  ];
                  return modes.map((m, i) => {
                    const diff = m.actual - m.system;
                    return (
                      <tr key={`${c.id}-${m.label}`} className="hover:bg-slate-50">
                        {i === 0 && <td className="px-3 py-2 font-medium text-slate-700" rowSpan={3}>{c.month}</td>}
                        <td className="px-3 py-2 text-slate-600">{m.label}</td>
                        <td className="px-3 py-2 text-right">KES {formatKES(m.system)}</td>
                        <td className="px-3 py-2 text-right">KES {formatKES(m.actual)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${diff === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {diff === 0 ? 'Match' : `${diff > 0 ? '+' : ''}${formatKES(diff)}`}
                        </td>
                        {i === 0 && (
                          <td className="px-3 py-2 text-center" rowSpan={3}>
                            <button onClick={() => startEditCount(c)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded">Edit</button>
                          </td>
                        )}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Physical Count Modal */}
      {editingCountId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Edit Physical Count</h3>
              <button onClick={() => setEditingCountId(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mpesa (actual)</label>
                <input type="number" value={editCountForm.mpesa} onChange={(e) => setEditCountForm({ ...editCountForm, mpesa: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cash (actual)</label>
                <input type="number" value={editCountForm.cash} onChange={(e) => setEditCountForm({ ...editCountForm, cash: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Paybill / Bank (actual)</label>
                <input type="number" value={editCountForm.paybill} onChange={(e) => setEditCountForm({ ...editCountForm, paybill: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <button onClick={handleUpdateCount} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-emerald-600" />
            <span className="font-semibold text-slate-800">Filters</span>
          </div>
          {showFilters ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>

        {showFilters && (
          <div className="px-4 pb-4 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Date Preset */}
              <div className="md:col-span-2 lg:col-span-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Date Range</label>
                <DateFilterBar
                  preset={filters.datePreset}
                  customFrom={filters.customFrom}
                  customTo={filters.customTo}
                  onChange={(p, from, to) => applyDatePreset(p, from, to)}
                />
              </div>

              {/* Entity Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Report Type</label>
                <select
                  value={filters.entityType}
                  onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  {entityTypes.map((et) => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </select>
              </div>

              {/* Customer Filter */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Customer</label>
                <select
                  value={filters.customerId}
                  onChange={(e) => setFilters((f) => ({ ...f, customerId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">All Customers</option>
                  {sortCustomersByBalance(customers).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Supplier Filter */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Supplier</label>
                <select
                  value={filters.supplierId}
                  onChange={(e) => setFilters((f) => ({ ...f, supplierId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">All Suppliers</option>
                  {sortSuppliersByBalance(suppliers).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Expense Category */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expense Category</label>
                <select
                  value={filters.expenseCategory}
                  onChange={(e) => setFilters((f) => ({ ...f, expenseCategory: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">All Categories</option>
                  {expenseCategories.map((ec) => (
                    <option key={ec.id} value={ec.name}>{ec.name}</option>
                  ))}
                </select>
              </div>

              {/* Payment Mode */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment Mode</label>
                <select
                  value={filters.paymentMode}
                  onChange={(e) => setFilters((f) => ({ ...f, paymentMode: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">All Modes</option>
                  <option value="mpesa">Mpesa</option>
                  <option value="cash">Cash</option>
                  <option value="paybill">Paybill</option>
                  <option value="credit">Credit</option>
                  <option value="advance">Advance</option>
                  <option value="split">Split</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => { setFilters(emptyFilters); applyDatePreset('month', '', ''); }}
                className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
              >
                <X size={14} /> Reset Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <SummaryCard title="Total In" amount={summary.totalIn} color="text-emerald-600" />
        <SummaryCard title="Total Out" amount={summary.totalOut} color="text-red-600" />
        <SummaryCard title="Net" amount={summary.net} color={summary.net >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <SummaryCard title="Sales" amount={summary.salesTotal} color="text-blue-600" />
        <SummaryCard title="Gross Profit" amount={summary.grossProfit} color="text-emerald-600" />
        <SummaryCard title="Net Profit" amount={summary.netProfit} color="text-emerald-600" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard title="Shop Expenses" amount={summary.shopExpenseTotal} color="text-red-600" />
        <SummaryCard title="Home Expenses" amount={summary.homeExpenseTotal} color="text-orange-600" />
        <SummaryCard title="Partner Draws" amount={summary.partnerDrawTotal} color="text-purple-600" />
        <SummaryCard title="Loan Repayments" amount={summary.loanPaymentTotal} color="text-orange-600" />
        <SummaryCard title="Supplier Payments" amount={summary.supplierPaymentTotal} color="text-amber-600" />
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Transaction Details</h3>
          <span className="text-sm text-slate-500">{filteredTransactions.length} entries</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No transactions found for selected filters</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2">Mode</th>
                  <th className="px-4 py-2 text-right">Debit</th>
                  <th className="px-4 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.map((t) => {
                  const dc = getDebitCredit(t);
                  return (
                    <tr key={t.id} className={`hover:bg-slate-50 transition-colors ${isSaleIncomplete(t) ? 'bg-green-50' : ''}`} title={isSaleIncomplete(t) ? 'Missing payment mode, cost price, or selling price' : undefined}>
                      <td className="px-4 py-2 text-slate-600">{formatDate(t.date)}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{t.transaction_id}</td>
                      <td className="px-4 py-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                          {t.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{t.description || '-'}</td>
                      <td className="px-4 py-2 text-slate-600 text-xs">{getEntityName(t)}</td>
                      <td className="px-4 py-2 text-slate-600 text-xs">{getModeDisplay(t)}</td>
                      <td className="px-4 py-2 text-right text-red-600">{dc.debit > 0 ? formatKES(dc.debit) : ''}</td>
                      <td className="px-4 py-2 text-right text-emerald-600">{dc.credit > 0 ? formatKES(dc.credit) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly Profit Summary */}
      {monthlyProfit.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Monthly Profit Summary</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-2">Month</th>
                  <th className="px-4 py-2 text-right">Total Profit</th>
                  <th className="px-4 py-2 text-right">Taher Share</th>
                  <th className="px-4 py-2 text-right">Abdulqadir Share</th>
                  <th className="px-4 py-2 text-right">Taher Taken</th>
                  <th className="px-4 py-2 text-right">Abdulqadir Taken</th>
                  <th className="px-4 py-2 text-right">Retained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlyProfit.map((mp) => (
                  <tr key={mp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 text-slate-700">{getMonthLabel(mp.month)}</td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-600">{formatKES(mp.total_profit)}</td>
                    <td className="px-4 py-2 text-right text-slate-600">{formatKES(mp.taher_share)}</td>
                    <td className="px-4 py-2 text-right text-slate-600">{formatKES(mp.abdulqadir_share)}</td>
                    <td className="px-4 py-2 text-right text-red-600">{formatKES(mp.taher_taken)}</td>
                    <td className="px-4 py-2 text-right text-red-600">{formatKES(mp.abdulqadir_taken)}</td>
                    <td className="px-4 py-2 text-right font-medium text-blue-600">{formatKES(mp.retained)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, amount, color }: { title: string; amount: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs text-slate-500 mb-1">{title}</p>
      <p className={`text-lg font-bold ${color}`}>KES {formatKES(amount)}</p>
    </div>
  );
}
