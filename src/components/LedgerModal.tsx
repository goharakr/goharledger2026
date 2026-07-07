import { useState, useEffect } from 'react';
import { X, Filter, Download, Trash2, Edit2, Save } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate } from '../utils/format';
import { useDataRefresh } from '../context/DataContext';
import { adjustCustomerCredit, adjustCustomerAdvance, adjustSupplierBalance, adjustLoanBalance } from '../utils/balances';
import type { Transaction, Customer, Supplier } from '../types';

interface LedgerModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  filterTypes?: string[];
  filterCustomerId?: string;
  filterSupplierId?: string;
  filterPartnerId?: string;
  filterLoanId?: string;
}

type DateFilterType = 'today' | 'yesterday' | 'last7days' | 'thismonth' | 'lastmonth' | 'custom';

export default function LedgerModal({
  open,
  onClose,
  title,
  filterTypes,
  filterCustomerId,
  filterSupplierId,
  filterPartnerId,
  filterLoanId,
}: LedgerModalProps) {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const [entries, setEntries] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterType>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ amount: '', notes: '' });

  useEffect(() => {
    if (open) {
      updateDateRange('today');
    }
  }, [open]);

  useEffect(() => {
    if (open && fromDate && toDate) {
      fetchEntries();
    }
  }, [open, dateFilter, fromDate, toDate, refreshKey]);

  function updateDateRange(filter: DateFilterType) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (filter === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (filter === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      setFromDate(yesterdayStr);
      setToDate(yesterdayStr);
    } else if (filter === 'last7days') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 6);
      setFromDate(weekAgo.toISOString().split('T')[0]);
      setToDate(todayStr);
    } else if (filter === 'thismonth') {
      const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      setFromDate(monthStart);
      setToDate(todayStr);
    } else if (filter === 'lastmonth') {
      const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      setFromDate(firstDayLastMonth.toISOString().split('T')[0]);
      setToDate(lastDayLastMonth.toISOString().split('T')[0]);
    }
  }

  async function fetchEntries() {
    setLoading(true);
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('is_void', false)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (fromDate && toDate) {
      query = query.gte('date', fromDate).lte('date', toDate);
    }

    if (filterTypes && filterTypes.length > 0) {
      query = query.in('type', filterTypes);
    }
    if (filterCustomerId) query = query.eq('customer_id', filterCustomerId);
    if (filterSupplierId) query = query.eq('supplier_id', filterSupplierId);
    if (filterPartnerId) query = query.eq('partner_id', filterPartnerId);
    if (filterLoanId) query = query.eq('loan_id', filterLoanId);

    const [{ data: txns }, { data: splitData }, { data: custData }, { data: suppData }] = await Promise.all([
      query,
      supabase.from('transaction_splits').select('*'),
      supabase.from('customers').select('*'),
      supabase.from('suppliers').select('*'),
    ]);

    setEntries(txns || []);
    setSplits(splitData || []);
    setCustomers(custData || []);
    setSuppliers(suppData || []);
    setLoading(false);
  }

  function getEntityName(txn: Transaction): string {
    if (txn.customer_id) {
      const cust = customers.find((c) => c.id === txn.customer_id);
      return cust ? `Customer: ${cust.name}` : '';
    }
    if (txn.supplier_id) {
      const supp = suppliers.find((s) => s.id === txn.supplier_id);
      return supp ? `Supplier: ${supp.name}` : '';
    }
    return '';
  }

  function getModeDisplay(txn: Transaction) {
    if (txn.primary_mode === 'split') {
      const s = splits.filter((sp) => sp.transaction_id === txn.transaction_id);
      if (s.length === 0) return 'Split';
      return s.map((sp) => `${sp.mode}: ${formatKES(sp.amount)}`).join(', ');
    }
    return txn.primary_mode || '-';
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to void this entry? This will reverse any balance changes.')) return;

    const txn = entries.find((e) => e.id === id);
    if (!txn) return;

    // Reverse whatever balance this entry affected when it was created - covers
    // every type that can show up in this shared ledger, not just sales
    if (txn.type === 'sale') {
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
    } else if (txn.type === 'customer_payment' && txn.customer_id) {
      // Both the "Add Advance" flow and the opening-advance mirror ("Opening
      // advance - X") deposit into advance_balance, not credit_balance
      const isAdvanceDeposit = txn.description?.startsWith('Advance from') || txn.transaction_id.startsWith('OPN-ADV-');
      if (isAdvanceDeposit) {
        await adjustCustomerAdvance(txn.customer_id, -(txn.amount || 0));
      } else {
        await adjustCustomerCredit(txn.customer_id, txn.amount || 0);
      }
    } else if (txn.type === 'supplier_payment' && txn.supplier_id) {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
    } else if (txn.type === 'supplier_invoice' && txn.supplier_id) {
      await adjustSupplierBalance(txn.supplier_id, -(txn.amount || 0));
    } else if (txn.type === 'opening_balance' && txn.customer_id) {
      // Customer "opening balance owed" mirror - reverse the receivable
      await adjustCustomerCredit(txn.customer_id, -(txn.amount || 0));
    } else if (txn.type === 'expense') {
      if (txn.supplier_id && (txn.category === 'supplier_payment' || txn.category === 'stock')) {
        await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
      }
      if (txn.loan_id) {
        await adjustLoanBalance(txn.loan_id, -(txn.amount || 0));
      }
    } else if (txn.type === 'loan_payment' && txn.loan_id) {
      await adjustLoanBalance(txn.loan_id, -(txn.amount || 0));
    } else if (txn.type === 'capital_entry' && txn.transaction_id.startsWith('CAP-')) {
      // Capital entries are mirrored here from the Capital page - keep the
      // actual record in sync instead of only voiding the mirror
      await supabase.from('capital_entries').delete().eq('id', txn.transaction_id.slice(4));
    }

    await supabase.from('transactions').update({ is_void: true, void_reason: 'Deleted from ledger' }).eq('id', id);
    fetchEntries();
    triggerRefresh();
  }

  function startEdit(txn: Transaction) {
    setEditingEntry(txn.id);
    setEditForm({
      amount: String(txn.amount || ''),
      notes: txn.notes || '',
    });
  }

  async function handleUpdateEntry() {
    if (!editingEntry) return;
    const txn = entries.find((e) => e.id === editingEntry);
    if (!txn) return;

    const newAmount = parseFloat(editForm.amount);
    const delta = newAmount - (txn.amount || 0);

    const updatePayload: Record<string, unknown> = {
      amount: newAmount,
      notes: editForm.notes || null,
      edited_at: new Date().toISOString(),
    };
    // Sales totals/profit read selling_price, not amount - keep them in sync
    if (txn.type === 'sale') {
      updatePayload.selling_price = newAmount;
    }

    await supabase.from('transactions').update(updatePayload).eq('id', editingEntry);

    // Capital entries are mirrored here from the Capital page - keep the
    // actual record in sync with whatever was just edited on the mirror
    if (txn.type === 'capital_entry' && txn.transaction_id.startsWith('CAP-')) {
      await supabase.from('capital_entries').update({
        amount: newAmount,
        description: editForm.notes || null,
      }).eq('id', txn.transaction_id.slice(4));
    }

    // Keep any linked balance in sync with the amount change instead of
    // letting it silently drift out of step with the edited transaction
    if (delta !== 0) {
      if (txn.type === 'sale') {
        if (txn.customer_id && txn.primary_mode === 'credit') await adjustCustomerCredit(txn.customer_id, delta);
        if (txn.customer_id && txn.primary_mode === 'advance') await adjustCustomerAdvance(txn.customer_id, -delta);
        if (txn.supplier_id && txn.primary_mode === 'supplier') await adjustSupplierBalance(txn.supplier_id, -delta);
      } else if (txn.type === 'customer_payment' && txn.customer_id) {
        if (txn.description?.startsWith('Advance from')) await adjustCustomerAdvance(txn.customer_id, delta);
        else await adjustCustomerCredit(txn.customer_id, -delta);
      } else if (txn.type === 'supplier_payment' && txn.supplier_id) {
        await adjustSupplierBalance(txn.supplier_id, -delta);
      } else if (txn.type === 'supplier_invoice' && txn.supplier_id) {
        await adjustSupplierBalance(txn.supplier_id, delta);
      } else if (txn.type === 'expense') {
        if (txn.supplier_id && (txn.category === 'supplier_payment' || txn.category === 'stock')) {
          await adjustSupplierBalance(txn.supplier_id, -delta);
        }
        if (txn.loan_id) await adjustLoanBalance(txn.loan_id, delta);
      } else if (txn.type === 'loan_payment' && txn.loan_id) {
        await adjustLoanBalance(txn.loan_id, delta);
      }
    }

    setEditingEntry(null);
    fetchEntries();
    triggerRefresh();
  }

  function exportCSV() {
    const headers = ['Date', 'ID', 'Type', 'Description', 'Mode', 'Amount', 'Created By'];
    const rows = entries.map((e) => [
      e.date,
      e.transaction_id,
      e.type,
      e.description || '',
      getModeDisplay(e),
      e.amount,
      e.created_by || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700">
              <Download size={14} /> Export
            </button>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400" />
            <select
              value={dateFilter}
              onChange={(e) => {
                const val = e.target.value as DateFilterType;
                setDateFilter(val);
                if (val !== 'custom') {
                  updateDateRange(val);
                }
              }}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7days">Last 7 Days</option>
              <option value="thismonth">This Month</option>
              <option value="lastmonth">Last Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {dateFilter === 'custom' && (
            <>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </>
          )}
          <button
            onClick={fetchEntries}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm"
          >
            Apply
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center text-slate-400 py-8">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center text-slate-400 py-8">No entries found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Customer/Supplier</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-slate-600">{formatDate(e.date)}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{e.transaction_id}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                        {e.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{getEntityName(e)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {e.description || '-'}
                      {e.edited_at && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title={`Edited ${formatDate(e.edited_at)}`}>
                          Edited
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{getModeDisplay(e)}</td>
                    {editingEntry === e.id ? (
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editForm.amount}
                          onChange={(ev) => setEditForm({ ...editForm, amount: ev.target.value })}
                          className="w-24 border border-slate-300 rounded px-2 py-1 text-sm text-right"
                        />
                      </td>
                    ) : (
                      <td className="px-3 py-2 text-right font-medium text-slate-800">{formatKES(e.amount)}</td>
                    )}
                    <td className="px-3 py-2 text-slate-500 text-xs capitalize">{e.created_by || '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {editingEntry === e.id ? (
                          <>
                            <button
                              onClick={handleUpdateEntry}
                              className="p-1 hover:bg-emerald-100 rounded text-emerald-600"
                              title="Save"
                            >
                              <Save size={14} />
                            </button>
                            <button
                              onClick={() => setEditingEntry(null)}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(e)}
                              className="p-1 hover:bg-slate-200 rounded"
                              title="Edit"
                            >
                              <Edit2 size={14} className="text-slate-500" />
                            </button>
                            <button
                              onClick={() => handleDelete(e.id)}
                              className="p-1 hover:bg-red-100 rounded"
                              title="Delete/Void"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Total: {entries.length} entries</span>
            <span className="font-medium text-slate-800">
              Sum: KES {formatKES(entries.reduce((sum, e) => sum + (e.amount || 0), 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}