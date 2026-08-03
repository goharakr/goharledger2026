import { useState, useEffect, useMemo, ReactNode } from 'react';
import {
  FileText,
  Download,
  Printer,
  X,
  ShoppingCart,
  Receipt,
  Home,
  Users,
  Truck,
  User,
  Landmark,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, getMonthLabel, saleProfit, todayStr } from '../utils/format';
import { sortCustomersByBalance, sortSuppliersByBalance } from '../utils/sortEntities';
import { buildMonthlyFigures, calculateShareEarned } from '../utils/shareDue';
import { fetchAllRows } from '../utils/fetchAll';
import { useDataRefresh } from '../context/DataContext';
import { usePersistentState } from '../context/PageStateContext';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Transaction, Customer, Supplier, ExpenseCategory, LoanTracker, HistoricalProfit } from '../types';

type ReportKey = 'sales' | 'expenses' | 'home_expenses' | 'partners' | 'suppliers' | 'customers' | 'loans' | 'cash_reconciliation' | 'monthly_profit';

const REPORT_LIST: { key: ReportKey; label: string; icon: typeof ShoppingCart }[] = [
  { key: 'sales', label: 'Sales', icon: ShoppingCart },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'home_expenses', label: 'Home Expenses', icon: Home },
  { key: 'partners', label: 'Partners', icon: Users },
  { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'customers', label: 'Customers', icon: User },
  { key: 'loans', label: 'Loans', icon: Landmark },
  { key: 'cash_reconciliation', label: 'Cash Reconciliation', icon: Scale },
  { key: 'monthly_profit', label: 'Monthly Profit Summary', icon: TrendingUp },
];

// ---------- shared export helpers, reused by every report below ----------

function exportCSVReport(headers: string[], rows: (string | number)[][], filename: string) {
  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportExcelReport(title: string, summaryRows: (string | number)[][], headers: string[], rows: (string | number)[][], filename: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  if (summaryRows.length) {
    const summarySheet = XLSX.utils.aoa_to_sheet([[title, ''], ['Summary', ''], ...summaryRows]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  }
  const detailSheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Details');
  XLSX.writeFile(wb, filename);
}

async function exportPDFReport(title: string, summaryRows: (string | number)[][], headers: string[], rows: (string | number)[][], filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFontSize(10);
  doc.text(`Generated ${todayStr()}`, 14, 22);
  let y = 28;
  if (summaryRows.length) {
    autoTable(doc, { startY: y, head: [['Summary', 'Amount']], body: summaryRows, theme: 'striped', headStyles: { fillColor: [5, 150, 105] } });
    y = (doc as any).lastAutoTable.finalY + 8;
  }
  autoTable(doc, { startY: y, head: [headers], body: rows, theme: 'striped', headStyles: { fillColor: [5, 150, 105] }, styles: { fontSize: 8 } });
  doc.save(filename);
}

// ---------- shared small UI pieces ----------

function ReportHeader({ title, onCSV, onExcel, onPDF }: { title: string; onCSV: () => void; onExcel: () => void; onPDF: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-bold text-slate-800">{title}</h3>
      <div className="flex items-center gap-2">
        <button onClick={onCSV} className="text-sm bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1"><Download size={14} /> CSV</button>
        <button onClick={onExcel} className="text-sm bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1"><Download size={14} /> Excel</button>
        <button onClick={onPDF} className="text-sm bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1"><Download size={14} /> PDF</button>
        <button onClick={() => window.print()} className="text-sm bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1"><Printer size={14} /> Print</button>
      </div>
    </div>
  );
}

function FilterBar({ children }: { children: ReactNode }) {
  return <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-3">{children}</div>;
}

function SummaryCard({ title, amount, color }: { title: string; amount: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs text-slate-500 mb-1">{title}</p>
      <p className={`text-lg font-bold ${color}`}>KES {formatKES(amount)}</p>
    </div>
  );
}

function ReportTable({ headers, rows, loading, empty }: { headers: string[]; rows: (string | number)[][]; loading?: boolean; empty?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
      {loading ? (
        <div className="p-8 text-center text-slate-400">Loading...</div>
      ) : empty ? (
        <div className="p-8 text-center text-slate-400">No entries found</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
              {headers.map((h) => <th key={h} className="px-4 py-2 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                {r.map((c, j) => <td key={j} className="px-4 py-2 text-slate-700 whitespace-nowrap">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface DateModeFilter {
  datePreset: DatePreset;
  customFrom: string;
  customTo: string;
  mode: string;
}
const defaultDateModeFilter: DateModeFilter = { datePreset: 'month', customFrom: '', customTo: '', mode: '' };

function ModeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
      <option value="">All Modes</option>
      <option value="mpesa">Mpesa</option>
      <option value="cash">Cash</option>
      <option value="paybill">Paybill</option>
    </select>
  );
}

// ==================== Sales ====================

function SalesReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<{ datePreset: DatePreset; customFrom: string; customTo: string }>('reports.sales.filter', { datePreset: 'month', customFrom: '', customTo: '' });
  const [sales, setSales] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: splitData }, { data: custData }] = await Promise.all([
      fetchAllRows<Transaction>((r1, r2) =>
        supabase.from('transactions').select('*').eq('type', 'sale').eq('is_void', false).gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: false }).range(r1, r2)
      ),
      supabase.from('transaction_splits').select('*'),
      supabase.from('customers').select('*'),
    ]);
    setSales(txns || []);
    setSplits(splitData || []);
    setCustomers(custData || []);
    setLoading(false);
  }

  const splitMap = useMemo(() => {
    const m = new Map<string, { mode: string; amount: number }[]>();
    splits.forEach((s) => { if (!m.has(s.transaction_id)) m.set(s.transaction_id, []); m.get(s.transaction_id)!.push(s); });
    return m;
  }, [splits]);

  function getModeDisplay(t: Transaction) {
    if (t.primary_mode === 'split') {
      const s = splitMap.get(t.transaction_id) || [];
      return s.length ? s.map((sp) => `${sp.mode}: ${formatKES(sp.amount)}`).join(', ') : 'Split';
    }
    return t.primary_mode || '-';
  }

  function getCustomerName(t: Transaction) {
    if (!t.customer_id) return '-';
    return customers.find((c) => c.id === t.customer_id)?.name || 'Customer';
  }

  const summary = useMemo(() => {
    const modeTotals: Record<string, number> = { mpesa: 0, cash: 0, paybill: 0, credit: 0, advance: 0, supplier: 0 };
    let totalSales = 0;
    let grossProfit = 0;
    sales.forEach((t) => {
      const sp = t.selling_price ?? t.amount ?? 0;
      totalSales += sp;
      grossProfit += saleProfit(t);
      if (t.primary_mode === 'split') {
        (splitMap.get(t.transaction_id) || []).forEach((s) => { modeTotals[s.mode] = (modeTotals[s.mode] || 0) + s.amount; });
      } else if (t.primary_mode && Object.prototype.hasOwnProperty.call(modeTotals, t.primary_mode)) {
        modeTotals[t.primary_mode] += sp;
      }
    });
    return { modeTotals, totalSales, totalCost: totalSales - grossProfit, grossProfit };
  }, [sales, splitMap]);

  const tableHeaders = ['Date', 'ID', 'Customer', 'Mode', 'SP', 'CP', 'Profit'];
  function buildRows(forExport: boolean) {
    return sales.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      getCustomerName(t),
      getModeDisplay(t),
      forExport ? (t.selling_price ?? t.amount ?? 0) : formatKES(t.selling_price ?? t.amount),
      forExport ? (t.cost_price || 0) : formatKES(t.cost_price || 0),
      forExport ? saleProfit(t) : formatKES(saleProfit(t)),
    ]);
  }
  function summaryForExport() {
    return [
      ['Total Sales', summary.totalSales], ['Total Cost', summary.totalCost], ['Gross Profit', summary.grossProfit],
      ['Mpesa', summary.modeTotals.mpesa], ['Cash', summary.modeTotals.cash], ['Paybill', summary.modeTotals.paybill],
      ['Credit', summary.modeTotals.credit], ['Advance', summary.modeTotals.advance], ['Supplier', summary.modeTotals.supplier],
    ];
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Sales Report"
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `sales-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport('Sales Report', summaryForExport(), tableHeaders, buildRows(true), `sales-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport('Sales Report', summaryForExport().map(([l, v]) => [l, formatKES(v as number)]), tableHeaders, buildRows(false), `sales-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ datePreset: p, customFrom: f, customTo: t })} />
      </FilterBar>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryCard title="Total Sales" amount={summary.totalSales} color="text-blue-600" />
        <SummaryCard title="Total Cost" amount={summary.totalCost} color="text-red-600" />
        <SummaryCard title="Gross Profit" amount={summary.grossProfit} color="text-emerald-600" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard title="Mpesa" amount={summary.modeTotals.mpesa} color="text-slate-700" />
        <SummaryCard title="Cash" amount={summary.modeTotals.cash} color="text-slate-700" />
        <SummaryCard title="Paybill" amount={summary.modeTotals.paybill} color="text-slate-700" />
        <SummaryCard title="Credit" amount={summary.modeTotals.credit} color="text-amber-600" />
        <SummaryCard title="Advance" amount={summary.modeTotals.advance} color="text-purple-600" />
        <SummaryCard title="Supplier" amount={summary.modeTotals.supplier} color="text-orange-600" />
      </div>
      <ReportTable loading={loading} empty={sales.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Expenses (shop) ====================

function ExpensesReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<DateModeFilter>('reports.expenses.filter', defaultDateModeFilter);
  const [expenses, setExpenses] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, filter.mode, refreshKey]);

  async function fetchData() {
    setLoading(true);
    let query = supabase.from('transactions').select('*').eq('type', 'expense').neq('category', 'home_expense').eq('is_void', false).gte('date', dateFrom).lte('date', dateTo);
    if (filter.mode) query = query.eq('primary_mode', filter.mode);
    const [{ data: txns }, { data: cats }] = await Promise.all([
      query.order('date', { ascending: false }),
      supabase.from('expense_categories').select('*'),
    ]);
    setExpenses(txns || []);
    setCategories(cats || []);
    setLoading(false);
  }

  function categoryLabel(cat: string | null) {
    return (cat || 'misc').replace(/_/g, ' ');
  }

  const summary = useMemo(() => {
    const modeTotals: Record<string, number> = { mpesa: 0, cash: 0, paybill: 0 };
    const categoryTotals = new Map<string, number>();
    let total = 0;
    expenses.forEach((t) => {
      total += t.amount;
      if (t.primary_mode && Object.prototype.hasOwnProperty.call(modeTotals, t.primary_mode)) modeTotals[t.primary_mode] += t.amount;
      const key = categoryLabel(t.category);
      categoryTotals.set(key, (categoryTotals.get(key) || 0) + t.amount);
    });
    return { modeTotals, total, categoryTotals: Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]) };
  }, [expenses]);

  const tableHeaders = ['Date', 'ID', 'Category', 'Description', 'Mode', 'Amount'];
  function buildRows(forExport: boolean) {
    return expenses.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      categoryLabel(t.category),
      t.description || '-',
      t.primary_mode || '-',
      forExport ? t.amount : formatKES(t.amount),
    ]);
  }
  function summaryForExport() {
    return [
      ['Total', summary.total], ['Mpesa', summary.modeTotals.mpesa], ['Cash', summary.modeTotals.cash], ['Paybill', summary.modeTotals.paybill],
      ...summary.categoryTotals.map(([c, v]) => [c, v]),
    ];
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Expenses Report"
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `expenses-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport('Expenses Report', summaryForExport(), tableHeaders, buildRows(true), `expenses-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport('Expenses Report', summaryForExport().map(([l, v]) => [l, formatKES(v as number)]), tableHeaders, buildRows(false), `expenses-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
        <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
      </FilterBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard title="Total" amount={summary.total} color="text-red-600" />
        <SummaryCard title="Mpesa" amount={summary.modeTotals.mpesa} color="text-slate-700" />
        <SummaryCard title="Cash" amount={summary.modeTotals.cash} color="text-slate-700" />
        <SummaryCard title="Paybill" amount={summary.modeTotals.paybill} color="text-slate-700" />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100"><h4 className="font-semibold text-slate-800 text-sm">By Category</h4></div>
        <div className="divide-y divide-slate-100">
          {summary.categoryTotals.length === 0 ? (
            <div className="p-4 text-center text-slate-400 text-sm">No entries found</div>
          ) : summary.categoryTotals.map(([cat, amt]) => (
            <div key={cat} className="px-4 py-2 flex items-center justify-between text-sm">
              <span className="text-slate-600 capitalize">{cat}</span>
              <span className="font-medium text-red-600">KES {formatKES(amt)}</span>
            </div>
          ))}
        </div>
      </div>
      <ReportTable loading={loading} empty={expenses.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Home Expenses ====================

function HomeExpensesReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<DateModeFilter & { partner: string }>('reports.homeExpenses.filter', { ...defaultDateModeFilter, partner: '' });
  const [expenses, setExpenses] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, filter.mode, filter.partner, refreshKey]);

  async function fetchData() {
    setLoading(true);
    let query = supabase.from('transactions').select('*').eq('type', 'expense').eq('category', 'home_expense').eq('is_void', false).gte('date', dateFrom).lte('date', dateTo);
    if (filter.mode) query = query.eq('primary_mode', filter.mode);
    if (filter.partner) query = query.eq('partner_id', filter.partner);
    const { data: txns } = await query.order('date', { ascending: false });
    setExpenses(txns || []);
    setLoading(false);
  }

  const summary = useMemo(() => {
    const modeTotals: Record<string, number> = { mpesa: 0, cash: 0, paybill: 0, ownPocket: 0 };
    const partnerTotals: Record<string, number> = { taher: 0, abdulqadir: 0 };
    let total = 0;
    expenses.forEach((t) => {
      total += t.amount;
      if (!t.primary_mode) modeTotals.ownPocket += t.amount;
      else if (Object.prototype.hasOwnProperty.call(modeTotals, t.primary_mode)) modeTotals[t.primary_mode] += t.amount;
      if (t.partner_id && Object.prototype.hasOwnProperty.call(partnerTotals, t.partner_id)) partnerTotals[t.partner_id] += t.amount;
    });
    return { modeTotals, partnerTotals, total };
  }, [expenses]);

  const tableHeaders = ['Date', 'ID', 'Partner', 'Source', 'Mode', 'Amount'];
  function buildRows(forExport: boolean) {
    return expenses.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      t.partner_id ? t.partner_id.charAt(0).toUpperCase() + t.partner_id.slice(1) : '-',
      t.notes?.includes('Own Pocket') ? 'Own Pocket' : 'Shop',
      t.primary_mode || '-',
      forExport ? t.amount : formatKES(t.amount),
    ]);
  }
  function summaryForExport() {
    return [
      ['Total', summary.total], ['Mpesa', summary.modeTotals.mpesa], ['Cash', summary.modeTotals.cash], ['Paybill', summary.modeTotals.paybill], ['Own Pocket', summary.modeTotals.ownPocket],
      ['Taher', summary.partnerTotals.taher], ['Abdulqadir', summary.partnerTotals.abdulqadir],
    ];
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Home Expenses Report"
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `home-expenses-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport('Home Expenses Report', summaryForExport(), tableHeaders, buildRows(true), `home-expenses-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport('Home Expenses Report', summaryForExport().map(([l, v]) => [l, formatKES(v as number)]), tableHeaders, buildRows(false), `home-expenses-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
        <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
        <select value={filter.partner} onChange={(e) => setFilter({ ...filter, partner: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
          <option value="">All Partners</option>
          <option value="taher">Taher</option>
          <option value="abdulqadir">Abdulqadir</option>
        </select>
      </FilterBar>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard title="Total" amount={summary.total} color="text-orange-600" />
        <SummaryCard title="Mpesa" amount={summary.modeTotals.mpesa} color="text-slate-700" />
        <SummaryCard title="Cash" amount={summary.modeTotals.cash} color="text-slate-700" />
        <SummaryCard title="Paybill" amount={summary.modeTotals.paybill} color="text-slate-700" />
        <SummaryCard title="Own Pocket" amount={summary.modeTotals.ownPocket} color="text-purple-600" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard title="Taher" amount={summary.partnerTotals.taher} color="text-blue-600" />
        <SummaryCard title="Abdulqadir" amount={summary.partnerTotals.abdulqadir} color="text-blue-600" />
      </div>
      <ReportTable loading={loading} empty={expenses.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Partners (draws + profit share) ====================

function PartnersReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<{ datePreset: DatePreset; customFrom: string; customTo: string; mode: string; partner: string }>('reports.partners.filter', { datePreset: 'month', customFrom: '', customTo: '', mode: '', partner: '' });
  const [allTxns, setAllTxns] = useState<Transaction[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [shareRules, setShareRules] = useState<{ partner_id: string; rule_type: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [refreshKey]);

  async function fetchData() {
    setLoading(true);
    // Share Due needs every month's activity, not just the filtered period - the
    // same reason Partners.tsx itself fetches without a date range.
    const [{ data: txns }, { data: hist }, { data: rules }] = await Promise.all([
      fetchAllRows<Transaction>((r1, r2) => supabase.from('transactions').select('*').eq('is_void', false).range(r1, r2)),
      supabase.from('historical_profit').select('*'),
      supabase.from('share_rules').select('*').eq('is_active', true),
    ]);
    setAllTxns(txns || []);
    setHistoricalProfit(hist || []);
    setShareRules(rules || []);
    setLoading(false);
  }

  const partners = filter.partner ? [filter.partner] : ['taher', 'abdulqadir'];

  const drawsInRange = useMemo(() => allTxns.filter((t) =>
    t.type === 'partner_draw' && t.date >= dateFrom && t.date <= dateTo && (!filter.mode || t.primary_mode === filter.mode) && (!filter.partner || t.partner_id === filter.partner)
  ), [allTxns, dateFrom, dateTo, filter.mode, filter.partner]);

  const perPartner = useMemo(() => {
    const txnsInRange = allTxns.filter((t) => t.date >= dateFrom && t.date <= dateTo);
    const monthlyInRange = buildMonthlyFigures(txnsInRange);
    const monthlyAll = buildMonthlyFigures(allTxns);
    const result: Record<string, { earnedInRange: number; takenInRange: number; shareDueOverall: number }> = {};
    partners.forEach((p) => {
      const rule = shareRules.find((r) => r.partner_id === p);
      const earnedInRange = calculateShareEarned(monthlyInRange, rule);
      const takenInRange = allTxns.reduce((s, t) => (t.type === 'partner_draw' && t.partner_id === p && t.date >= dateFrom && t.date <= dateTo ? s + t.amount : s), 0);
      const earnedAll = calculateShareEarned(monthlyAll, rule);
      const histRemaining = historicalProfit.reduce((s, h) => {
        const share = p === 'taher' ? (h.taher_share || 0) : (h.abdulqadir_share || 0);
        const taken = p === 'taher' ? (h.taher_taken || 0) : (h.abdulqadir_taken || 0);
        return s + share - taken;
      }, 0);
      const drawsAllTime = allTxns.reduce((s, t) => (t.type === 'partner_draw' && t.partner_id === p ? s + t.amount : s), 0);
      result[p] = { earnedInRange, takenInRange, shareDueOverall: earnedAll + histRemaining - drawsAllTime };
    });
    return result;
  }, [allTxns, historicalProfit, shareRules, dateFrom, dateTo, filter.partner]);

  const tableHeaders = ['Date', 'ID', 'Partner', 'Mode', 'Amount', 'Notes'];
  function buildRows(forExport: boolean) {
    return drawsInRange.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      t.partner_id ? t.partner_id.charAt(0).toUpperCase() + t.partner_id.slice(1) : '-',
      t.primary_mode || '-',
      forExport ? t.amount : formatKES(t.amount),
      t.notes || t.description || '-',
    ]);
  }
  function summaryForExport() {
    const rows: (string | number)[][] = [];
    partners.forEach((p) => {
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      rows.push([`${label} - Earned (period)`, perPartner[p]?.earnedInRange || 0]);
      rows.push([`${label} - Taken (period)`, perPartner[p]?.takenInRange || 0]);
      rows.push([`${label} - Share Due (overall)`, perPartner[p]?.shareDueOverall || 0]);
    });
    return rows;
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Partners Report"
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `partners-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport('Partners Report', summaryForExport(), tableHeaders, buildRows(true), `partners-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport('Partners Report', summaryForExport().map(([l, v]) => [l, formatKES(v as number)]), tableHeaders, buildRows(false), `partners-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
        <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
        <select value={filter.partner} onChange={(e) => setFilter({ ...filter, partner: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
          <option value="">Both Partners</option>
          <option value="taher">Taher</option>
          <option value="abdulqadir">Abdulqadir</option>
        </select>
      </FilterBar>
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {partners.map((p) => (
            <div key={p} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
              <h4 className="font-semibold text-slate-800 capitalize">{p}</h4>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Share Earned (period)</span><span className="font-medium text-emerald-600">KES {formatKES(perPartner[p]?.earnedInRange || 0)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Draws Taken (period)</span><span className="font-medium text-red-600">KES {formatKES(perPartner[p]?.takenInRange || 0)}</span></div>
              <div className="flex justify-between text-sm border-t border-slate-100 pt-2"><span className="text-slate-500">Net (period)</span><span className="font-medium text-slate-800">KES {formatKES((perPartner[p]?.earnedInRange || 0) - (perPartner[p]?.takenInRange || 0))}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Share Due (overall, all-time)</span><span className={`font-medium ${(perPartner[p]?.shareDueOverall || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>KES {formatKES(perPartner[p]?.shareDueOverall || 0)}</span></div>
            </div>
          ))}
        </div>
      )}
      <ReportTable loading={loading} empty={drawsInRange.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Suppliers ====================

function SuppliersReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<DateModeFilter & { supplierId: string }>('reports.suppliers.filter', { ...defaultDateModeFilter, supplierId: '' });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, filter.mode, filter.supplierId, refreshKey]);

  async function fetchData() {
    setLoading(true);
    let query = supabase.from('transactions').select('*').eq('is_void', false).gte('date', dateFrom).lte('date', dateTo).not('supplier_id', 'is', null);
    if (filter.mode) query = query.eq('primary_mode', filter.mode);
    if (filter.supplierId) query = query.eq('supplier_id', filter.supplierId);
    const [{ data: suppData }, { data: txnData }] = await Promise.all([
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      query.order('date', { ascending: false }),
    ]);
    setSuppliers(suppData || []);
    setTxns(txnData || []);
    setLoading(false);
  }

  const selected = suppliers.find((s) => s.id === filter.supplierId);

  const paidPerSupplier = useMemo(() => {
    const m = new Map<string, number>();
    txns.forEach((t) => {
      if (t.type === 'supplier_payment' && t.supplier_id) m.set(t.supplier_id, (m.get(t.supplier_id) || 0) + t.amount);
    });
    return m;
  }, [txns]);

  if (!filter.supplierId) {
    const rows = sortSuppliersByBalance(suppliers).map((s) => [s.name, formatKES(paidPerSupplier.get(s.id) || 0), formatKES(s.balance)]);
    const exportRows = sortSuppliersByBalance(suppliers).map((s) => [s.name, paidPerSupplier.get(s.id) || 0, s.balance]);
    const headers = ['Supplier', 'Paid in Period', 'Current Balance'];
    return (
      <div className="space-y-4">
        <ReportHeader
          title="Suppliers Report"
          onCSV={() => exportCSVReport(headers, exportRows, `suppliers-report-${dateFrom}-to-${dateTo}.csv`)}
          onExcel={() => exportExcelReport('Suppliers Report', [], headers, exportRows, `suppliers-report-${dateFrom}-to-${dateTo}.xlsx`)}
          onPDF={() => exportPDFReport('Suppliers Report', [], headers, rows, `suppliers-report-${dateFrom}-to-${dateTo}.pdf`)}
        />
        <FilterBar>
          <select value={filter.supplierId} onChange={(e) => setFilter({ ...filter, supplierId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="">All Suppliers</option>
            {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
          <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
        </FilterBar>
        <ReportTable loading={loading} empty={suppliers.length === 0} headers={headers} rows={rows} />
      </div>
    );
  }

  const supplierTxns = txns.filter((t) => t.supplier_id === filter.supplierId);
  const tableHeaders = ['Date', 'ID', 'Type', 'Description', 'Mode', 'Amount'];
  function buildRows(forExport: boolean) {
    return supplierTxns.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      t.type.replace(/_/g, ' '),
      t.description || '-',
      t.primary_mode || '-',
      forExport ? t.amount : formatKES(t.amount),
    ]);
  }
  const totalPaid = supplierTxns.filter((t) => t.type === 'supplier_payment').reduce((s, t) => s + t.amount, 0);
  const totalInvoiced = supplierTxns.filter((t) => t.type === 'supplier_invoice').reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">
      <ReportHeader
        title={`Supplier Report - ${selected?.name || ''}`}
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `supplier-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport(`Supplier Report - ${selected?.name || ''}`, [['Paid (period)', totalPaid], ['Invoiced (period)', totalInvoiced], ['Current Balance', selected?.balance || 0]], tableHeaders, buildRows(true), `supplier-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport(`Supplier Report - ${selected?.name || ''}`, [['Paid (period)', formatKES(totalPaid)], ['Invoiced (period)', formatKES(totalInvoiced)], ['Current Balance', formatKES(selected?.balance || 0)]], tableHeaders, buildRows(false), `supplier-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <select value={filter.supplierId} onChange={(e) => setFilter({ ...filter, supplierId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
          <option value="">All Suppliers</option>
          {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
        <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
      </FilterBar>
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard title="Paid (period)" amount={totalPaid} color="text-emerald-600" />
        <SummaryCard title="Invoiced (period)" amount={totalInvoiced} color="text-amber-600" />
        <SummaryCard title="Current Balance" amount={selected?.balance || 0} color="text-red-600" />
      </div>
      <ReportTable loading={loading} empty={supplierTxns.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Customers ====================

function CustomersReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<DateModeFilter & { customerId: string }>('reports.customers.filter', { ...defaultDateModeFilter, customerId: '' });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, filter.mode, filter.customerId, refreshKey]);

  async function fetchData() {
    setLoading(true);
    let query = supabase.from('transactions').select('*').eq('is_void', false).gte('date', dateFrom).lte('date', dateTo).not('customer_id', 'is', null);
    if (filter.mode) query = query.eq('primary_mode', filter.mode);
    if (filter.customerId) query = query.eq('customer_id', filter.customerId);
    const [{ data: custData }, { data: txnData }] = await Promise.all([
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      query.order('date', { ascending: false }),
    ]);
    setCustomers(custData || []);
    setTxns(txnData || []);
    setLoading(false);
  }

  const selected = customers.find((c) => c.id === filter.customerId);

  const collectedPerCustomer = useMemo(() => {
    const m = new Map<string, number>();
    txns.forEach((t) => {
      if (t.type === 'customer_payment' && t.customer_id) m.set(t.customer_id, (m.get(t.customer_id) || 0) + t.amount);
    });
    return m;
  }, [txns]);

  if (!filter.customerId) {
    const sorted = sortCustomersByBalance(customers);
    const rows = sorted.map((c) => [c.name, formatKES(collectedPerCustomer.get(c.id) || 0), formatKES(c.credit_balance || 0), formatKES(c.advance_balance || 0)]);
    const exportRows = sorted.map((c) => [c.name, collectedPerCustomer.get(c.id) || 0, c.credit_balance || 0, c.advance_balance || 0]);
    const headers = ['Customer', 'Collected in Period', 'Credit Balance', 'Advance Balance'];
    return (
      <div className="space-y-4">
        <ReportHeader
          title="Customers Report"
          onCSV={() => exportCSVReport(headers, exportRows, `customers-report-${dateFrom}-to-${dateTo}.csv`)}
          onExcel={() => exportExcelReport('Customers Report', [], headers, exportRows, `customers-report-${dateFrom}-to-${dateTo}.xlsx`)}
          onPDF={() => exportPDFReport('Customers Report', [], headers, rows, `customers-report-${dateFrom}-to-${dateTo}.pdf`)}
        />
        <FilterBar>
          <select value={filter.customerId} onChange={(e) => setFilter({ ...filter, customerId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="">All Customers</option>
            {sortCustomersByBalance(customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
          <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
        </FilterBar>
        <ReportTable loading={loading} empty={customers.length === 0} headers={headers} rows={rows} />
      </div>
    );
  }

  const customerTxns = txns.filter((t) => t.customer_id === filter.customerId);
  const tableHeaders = ['Date', 'ID', 'Type', 'Description', 'Mode', 'Amount'];
  function buildRows(forExport: boolean) {
    return customerTxns.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      t.type.replace(/_/g, ' '),
      t.description || '-',
      t.primary_mode || '-',
      forExport ? t.amount : formatKES(t.amount),
    ]);
  }
  const totalCollected = customerTxns.filter((t) => t.type === 'customer_payment').reduce((s, t) => s + t.amount, 0);
  const totalSales = customerTxns.filter((t) => t.type === 'sale').reduce((s, t) => s + (t.selling_price ?? t.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <ReportHeader
        title={`Customer Report - ${selected?.name || ''}`}
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `customer-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport(`Customer Report - ${selected?.name || ''}`, [['Sales (period)', totalSales], ['Collected (period)', totalCollected], ['Credit Balance', selected?.credit_balance || 0], ['Advance Balance', selected?.advance_balance || 0]], tableHeaders, buildRows(true), `customer-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport(`Customer Report - ${selected?.name || ''}`, [['Sales (period)', formatKES(totalSales)], ['Collected (period)', formatKES(totalCollected)], ['Credit Balance', formatKES(selected?.credit_balance || 0)], ['Advance Balance', formatKES(selected?.advance_balance || 0)]], tableHeaders, buildRows(false), `customer-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <select value={filter.customerId} onChange={(e) => setFilter({ ...filter, customerId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
          <option value="">All Customers</option>
          {sortCustomersByBalance(customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
        <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
      </FilterBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard title="Sales (period)" amount={totalSales} color="text-blue-600" />
        <SummaryCard title="Collected (period)" amount={totalCollected} color="text-emerald-600" />
        <SummaryCard title="Credit Balance" amount={selected?.credit_balance || 0} color="text-red-600" />
        <SummaryCard title="Advance Balance" amount={selected?.advance_balance || 0} color="text-purple-600" />
      </div>
      <ReportTable loading={loading} empty={customerTxns.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Loans ====================

function LoansReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<DateModeFilter & { loanId: string }>('reports.loans.filter', { ...defaultDateModeFilter, loanId: '' });
  const [loans, setLoans] = useState<LoanTracker[]>([]);
  const [payments, setPayments] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, filter.mode, filter.loanId, refreshKey]);

  async function fetchData() {
    setLoading(true);
    let query = supabase.from('transactions').select('*').eq('type', 'loan_payment').eq('is_void', false).gte('date', dateFrom).lte('date', dateTo);
    if (filter.mode) query = query.eq('primary_mode', filter.mode);
    if (filter.loanId) query = query.eq('loan_id', filter.loanId);
    const [{ data: loanData }, { data: paymentData }] = await Promise.all([
      supabase.from('loan_trackers').select('*'),
      query.order('date', { ascending: false }),
    ]);
    setLoans(loanData || []);
    setPayments(paymentData || []);
    setLoading(false);
  }

  const selected = loans.find((l) => l.id === filter.loanId);

  const paidPerLoan = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach((t) => { if (t.loan_id) m.set(t.loan_id, (m.get(t.loan_id) || 0) + t.amount); });
    return m;
  }, [payments]);

  if (!filter.loanId) {
    const rows = loans.map((l) => [l.loan_name, formatKES(paidPerLoan.get(l.id) || 0), formatKES(l.remaining_balance), l.status]);
    const exportRows = loans.map((l) => [l.loan_name, paidPerLoan.get(l.id) || 0, l.remaining_balance, l.status]);
    const headers = ['Loan', 'Paid in Period', 'Remaining Balance', 'Status'];
    return (
      <div className="space-y-4">
        <ReportHeader
          title="Loans Report"
          onCSV={() => exportCSVReport(headers, exportRows, `loans-report-${dateFrom}-to-${dateTo}.csv`)}
          onExcel={() => exportExcelReport('Loans Report', [], headers, exportRows, `loans-report-${dateFrom}-to-${dateTo}.xlsx`)}
          onPDF={() => exportPDFReport('Loans Report', [], headers, rows, `loans-report-${dateFrom}-to-${dateTo}.pdf`)}
        />
        <FilterBar>
          <select value={filter.loanId} onChange={(e) => setFilter({ ...filter, loanId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="">All Loans</option>
            {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_name}</option>)}
          </select>
          <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
          <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
        </FilterBar>
        <ReportTable loading={loading} empty={loans.length === 0} headers={headers} rows={rows} />
      </div>
    );
  }

  const tableHeaders = ['Date', 'ID', 'Mode', 'Amount', 'Notes'];
  function buildRows(forExport: boolean) {
    return payments.map((t) => [
      forExport ? t.date : formatDate(t.date),
      t.transaction_id,
      t.primary_mode || '-',
      forExport ? t.amount : formatKES(t.amount),
      t.notes || t.description || '-',
    ]);
  }
  const totalPaidPeriod = payments.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">
      <ReportHeader
        title={`Loan Report - ${selected?.loan_name || ''}`}
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `loan-report-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport(`Loan Report - ${selected?.loan_name || ''}`, [['Paid (period)', totalPaidPeriod], ['Remaining Balance', selected?.remaining_balance || 0], ['Total Amount', selected?.total_amount || 0]], tableHeaders, buildRows(true), `loan-report-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport(`Loan Report - ${selected?.loan_name || ''}`, [['Paid (period)', formatKES(totalPaidPeriod)], ['Remaining Balance', formatKES(selected?.remaining_balance || 0)], ['Total Amount', formatKES(selected?.total_amount || 0)]], tableHeaders, buildRows(false), `loan-report-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <select value={filter.loanId} onChange={(e) => setFilter({ ...filter, loanId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
          <option value="">All Loans</option>
          {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_name}</option>)}
        </select>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ ...filter, datePreset: p, customFrom: f, customTo: t })} />
        <ModeSelect value={filter.mode} onChange={(m) => setFilter({ ...filter, mode: m })} />
      </FilterBar>
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard title="Paid (period)" amount={totalPaidPeriod} color="text-emerald-600" />
        <SummaryCard title="Remaining Balance" amount={selected?.remaining_balance || 0} color="text-red-600" />
        <SummaryCard title="Total Amount" amount={selected?.total_amount || 0} color="text-slate-700" />
      </div>
      <ReportTable loading={loading} empty={payments.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Cash Reconciliation ====================

function CashReconciliationReport() {
  const { refreshKey } = useDataRefresh();
  const [physicalCounts, setPhysicalCounts] = useState<{ id: string; month: string; mpesa_actual: number; cash_actual: number; paybill_actual: number; mpesa_system: number; cash_system: number; paybill_system: number }[]>([]);
  const [editingCountId, setEditingCountId] = useState<string | null>(null);
  const [editCountForm, setEditCountForm] = useState({ mpesa: '', cash: '', paybill: '' });

  useEffect(() => {
    supabase.from('physical_cash_counts').select('*').order('month', { ascending: false }).then(({ data }) => setPhysicalCounts(data || []));
  }, [refreshKey]);

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

  const tableHeaders = ['Month', 'Mode', 'System Said', 'You Counted', 'Difference'];
  function buildRows(forExport: boolean) {
    const rows: (string | number)[][] = [];
    physicalCounts.forEach((c) => {
      const modes: { label: string; system: number; actual: number }[] = [
        { label: 'Mpesa', system: c.mpesa_system, actual: c.mpesa_actual },
        { label: 'Cash', system: c.cash_system, actual: c.cash_actual },
        { label: 'Paybill', system: c.paybill_system, actual: c.paybill_actual },
      ];
      modes.forEach((m) => {
        const diff = m.actual - m.system;
        rows.push([c.month, m.label, forExport ? m.system : formatKES(m.system), forExport ? m.actual : formatKES(m.actual), forExport ? diff : (diff === 0 ? 'Match' : `${diff > 0 ? '+' : ''}${formatKES(diff)}`)]);
      });
    });
    return rows;
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Cash Reconciliation"
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `cash-reconciliation-${todayStr()}.csv`)}
        onExcel={() => exportExcelReport('Cash Reconciliation', [], tableHeaders, buildRows(true), `cash-reconciliation-${todayStr()}.xlsx`)}
        onPDF={() => exportPDFReport('Cash Reconciliation', [], tableHeaders, buildRows(false), `cash-reconciliation-${todayStr()}.pdf`)}
      />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
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
              {physicalCounts.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">No entries found</td></tr>
              ) : physicalCounts.map((c) => {
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

      {editingCountId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setEditingCountId(null); }}>
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
    </div>
  );
}

// ==================== Monthly Profit Summary ====================

function MonthlyProfitReport() {
  const { refreshKey } = useDataRefresh();
  const [filter, setFilter] = usePersistentState<{ datePreset: DatePreset; customFrom: string; customTo: string }>('reports.monthlyProfit.filter', { datePreset: 'all', customFrom: '', customTo: '' });
  const [monthlyProfit, setMonthlyProfit] = useState<HistoricalProfit[]>([]);
  const [loading, setLoading] = useState(true);

  const { from: dateFrom, to: dateTo } = getDatePresetRange(filter.datePreset, filter.customFrom, filter.customTo);

  useEffect(() => { fetchData(); }, [filter.datePreset, filter.customFrom, filter.customTo, refreshKey]);

  async function fetchData() {
    setLoading(true);
    const { data } = await supabase.from('historical_profit').select('*').gte('month', dateFrom.slice(0, 7)).lte('month', dateTo.slice(0, 7)).order('month', { ascending: false });
    setMonthlyProfit(data || []);
    setLoading(false);
  }

  const tableHeaders = ['Month', 'Total Profit', 'Taher Share', 'Abdulqadir Share', 'Taher Taken', 'Abdulqadir Taken', 'Retained'];
  function buildRows(forExport: boolean) {
    return monthlyProfit.map((mp) => [
      forExport ? mp.month : getMonthLabel(mp.month),
      forExport ? mp.total_profit : formatKES(mp.total_profit),
      forExport ? (mp.taher_share || 0) : formatKES(mp.taher_share || 0),
      forExport ? (mp.abdulqadir_share || 0) : formatKES(mp.abdulqadir_share || 0),
      forExport ? mp.taher_taken : formatKES(mp.taher_taken),
      forExport ? mp.abdulqadir_taken : formatKES(mp.abdulqadir_taken),
      forExport ? (mp.retained || 0) : formatKES(mp.retained || 0),
    ]);
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Monthly Profit Summary"
        onCSV={() => exportCSVReport(tableHeaders, buildRows(true), `monthly-profit-${dateFrom}-to-${dateTo}.csv`)}
        onExcel={() => exportExcelReport('Monthly Profit Summary', [], tableHeaders, buildRows(true), `monthly-profit-${dateFrom}-to-${dateTo}.xlsx`)}
        onPDF={() => exportPDFReport('Monthly Profit Summary', [], tableHeaders, buildRows(false), `monthly-profit-${dateFrom}-to-${dateTo}.pdf`)}
      />
      <FilterBar>
        <DateFilterBar preset={filter.datePreset} customFrom={filter.customFrom} customTo={filter.customTo} onChange={(p, f, t) => setFilter({ datePreset: p, customFrom: f, customTo: t })} />
      </FilterBar>
      <ReportTable loading={loading} empty={monthlyProfit.length === 0} headers={tableHeaders} rows={buildRows(false)} />
    </div>
  );
}

// ==================== Main page ====================

export default function Reports() {
  const [activeReport, setActiveReport] = usePersistentState<ReportKey>('reports.activeReport', 'sales');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
        <FileText size={24} className="text-emerald-600" />
        Reports
      </h2>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="w-full md:w-56 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
          {REPORT_LIST.map((r) => {
            const Icon = r.icon;
            const active = activeReport === r.key;
            return (
              <button
                key={r.key}
                onClick={() => setActiveReport(r.key)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-b border-slate-100 last:border-b-0 transition-colors ${
                  active ? 'bg-emerald-50 text-emerald-700 font-medium border-l-4 border-l-emerald-500' : 'text-slate-600 hover:bg-slate-50 border-l-4 border-l-transparent'
                }`}
              >
                <Icon size={16} className={active ? 'text-emerald-600' : 'text-slate-400'} />
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0">
          {activeReport === 'sales' && <SalesReport />}
          {activeReport === 'expenses' && <ExpensesReport />}
          {activeReport === 'home_expenses' && <HomeExpensesReport />}
          {activeReport === 'partners' && <PartnersReport />}
          {activeReport === 'suppliers' && <SuppliersReport />}
          {activeReport === 'customers' && <CustomersReport />}
          {activeReport === 'loans' && <LoansReport />}
          {activeReport === 'cash_reconciliation' && <CashReconciliationReport />}
          {activeReport === 'monthly_profit' && <MonthlyProfitReport />}
        </div>
      </div>
    </div>
  );
}
