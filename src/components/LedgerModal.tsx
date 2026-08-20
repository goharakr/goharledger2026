import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Filter, Download, Trash2, Edit2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, isSaleIncomplete, todayStr } from '../utils/format';
import { useDataRefresh } from '../context/DataContext';
import { adjustCustomerCredit, adjustCustomerAdvance, adjustSupplierBalance, adjustLoanBalance, undoSettlementForTransaction } from '../utils/balances';
import DateFilterBar from './DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Transaction, Customer, Supplier, Employee } from '../types';

interface LedgerModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  filterTypes?: string[];
  filterCustomerId?: string;
  filterSupplierId?: string;
  filterPartnerId?: string;
  filterLoanId?: string;
  filterEmployeeId?: string;
}

export default function LedgerModal({
  open,
  onClose,
  title,
  filterTypes,
  filterCustomerId,
  filterSupplierId,
  filterPartnerId,
  filterLoanId,
  filterEmployeeId,
}: LedgerModalProps) {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const { from: fromDate, to: toDate } = getDatePresetRange(datePreset, customFrom, customTo);

  useEffect(() => {
    if (open) {
      setDatePreset('today');
      setCustomFrom('');
      setCustomTo('');
      setTypeFilter('all');
      setCategoryFilter('all');
    }
  }, [open]);

  useEffect(() => {
    if (open && fromDate && toDate) {
      fetchEntries();
    }
  }, [open, datePreset, fromDate, toDate, refreshKey]);

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
    if (filterEmployeeId) query = query.eq('employee_id', filterEmployeeId);

    const [{ data: txns }, { data: splitData }, { data: custData }, { data: suppData }, { data: empData }] = await Promise.all([
      query,
      supabase.from('transaction_splits').select('*'),
      supabase.from('customers').select('*'),
      supabase.from('suppliers').select('*'),
      supabase.from('employees').select('*'),
    ]);

    setEntries(txns || []);
    setSplits(splitData || []);
    setCustomers(custData || []);
    setSuppliers(suppData || []);
    setEmployees(empData || []);
    setLoading(false);
  }

  const availableTypes = Array.from(new Set(entries.map((e) => e.type))).sort();
  const availableCategories = Array.from(
    new Set(entries.filter((e) => e.category).map((e) => e.category as string))
  ).sort();
  const filteredEntries = entries.filter(
    (e) =>
      (typeFilter === 'all' || e.type === typeFilter) &&
      (categoryFilter === 'all' || e.category === categoryFilter)
  );

  function getEntityName(txn: Transaction): string {
    if (txn.customer_id) {
      const cust = customers.find((c) => c.id === txn.customer_id);
      return cust ? `Customer: ${cust.name}` : '';
    }
    if (txn.supplier_id) {
      const supp = suppliers.find((s) => s.id === txn.supplier_id);
      return supp ? `Supplier: ${supp.name}` : '';
    }
    if (txn.employee_id) {
      const emp = employees.find((e) => e.id === txn.employee_id);
      return emp ? `Employee: ${emp.name}` : '';
    }
    return '';
  }

  function getModeDisplay(txn: Transaction) {
    if (txn.primary_mode === 'split') {
      const s = splits.filter((sp) => sp.transaction_id === txn.transaction_id);
      const parts = s.map((sp) => `${sp.mode}: ${formatKES(sp.amount)}`);
      // An Extra Payment Line that isn't real cash (Advance/Credit/Supplier)
      // doesn't get its own split row - whatever the cash lines above don't
      // cover is that leftover instead.
      const realSum = s.reduce((sum, sp) => sum + sp.amount, 0);
      const leftover = (txn.selling_price ?? txn.amount ?? 0) - realSum;
      if (leftover > 0.01) {
        const label = txn.customer_id && txn.settlement_mode ? 'advance' : txn.customer_id ? 'credit' : txn.supplier_id ? 'supplier' : null;
        if (label) parts.push(`${label}: ${formatKES(leftover)}`);
      }
      return parts.length ? parts.join(', ') : 'Split';
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
        await undoSettlementForTransaction(txn.transaction_id, null, txn.customer_id);
      }
    } else if (txn.type === 'supplier_payment' && txn.supplier_id) {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
      await undoSettlementForTransaction(txn.transaction_id, txn.supplier_id, null);
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

    const { error } = await supabase.from('transactions').update({ is_void: true, void_reason: 'Deleted from ledger' }).eq('id', id);
    if (error) { alert('Failed to void: ' + error.message); return; }
    fetchEntries();
    triggerRefresh();
  }

  // Every entry type now has a real full-form editor on its own home page
  // (date/mode/amount/notes and whatever else that type needs) - Edit here
  // jumps straight there with the form already open, instead of this modal
  // having its own second, weaker date/amount/notes-only editor that could
  // drift out of sync with the real one.
  function getEditRoute(txn: Transaction): string | null {
    switch (txn.type) {
      case 'sale': return `/sales?edit=${txn.id}`;
      case 'expense': return `/expenses?edit=${txn.id}`;
      case 'customer_payment': return `/customers?edit=${txn.id}`;
      case 'opening_balance': return txn.customer_id ? `/customers?edit=${txn.id}` : `/cash-bank?edit=${txn.id}`;
      case 'supplier_invoice':
      case 'supplier_payment': return `/suppliers?edit=${txn.id}`;
      case 'loan_payment':
      case 'capital_entry': return `/capital?edit=${txn.id}`;
      case 'partner_draw':
      case 'partner_loan': return `/partners?edit=${txn.id}${txn.partner_id ? `&partner=${txn.partner_id}` : ''}`;
      case 'fund_transfer': return `/cash-bank?edit=${txn.id}`;
      case 'employee_loan':
      case 'employee_advance':
      case 'employee_salary': return `/employees?edit=${txn.id}`;
      default: return null;
    }
  }

  function goEditEntry(txn: Transaction) {
    const route = getEditRoute(txn);
    if (!route) return;
    onClose();
    navigate(route);
  }

  function exportCSV() {
    const headers = ['Date', 'ID', 'Type', 'Description', 'Mode', 'Amount', 'Created By'];
    const rows = filteredEntries.map((e) => [
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
    a.download = `ledger-${todayStr()}.csv`;
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
            <DateFilterBar
              preset={datePreset}
              customFrom={customFrom}
              customTo={customTo}
              onChange={(p, cf, ct) => { setDatePreset(p); setCustomFrom(cf); setCustomTo(ct); }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none capitalize"
          >
            <option value="all">All Types</option>
            {availableTypes.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {availableCategories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none capitalize"
            >
              <option value="all">All Categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center text-slate-400 py-8">Loading...</div>
          ) : filteredEntries.length === 0 ? (
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
                {filteredEntries.map((e) => (
                  <tr key={e.id} className={`hover:bg-slate-50 transition-colors ${isSaleIncomplete(e) ? 'bg-green-50' : ''}`} title={isSaleIncomplete(e) ? 'Missing payment mode, cost price, or selling price' : undefined}>
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
                    <td className="px-3 py-2 text-right font-medium text-slate-800">{formatKES(e.amount)}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs capitalize">{e.created_by || '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {getEditRoute(e) && (
                          <button
                            onClick={() => goEditEntry(e)}
                            className="p-1 hover:bg-slate-200 rounded"
                            title="Edit"
                          >
                            <Edit2 size={14} className="text-slate-500" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="p-1 hover:bg-red-100 rounded"
                          title="Delete/Void"
                        >
                          <Trash2 size={14} className="text-red-500" />
                        </button>
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
            <span className="text-slate-500">Total: {filteredEntries.length} entries</span>
            <span className="font-medium text-slate-800">
              Sum: KES {formatKES(filteredEntries.reduce((sum, e) => sum + (e.amount || 0), 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}