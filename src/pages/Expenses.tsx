import { useEffect, useState, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  X,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Settings,
  BookOpen,
  UserPlus,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, todayStr } from '../utils/format';
import { adjustSupplierBalance, adjustLoanBalance, applySettlementSource, undoSettlementForTransaction } from '../utils/balances';
import { findBulkBatch } from '../utils/batchGroup';
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
import { findBestMatch } from '../utils/fuzzyMatch';
import { parseExpenseSheetText } from '../utils/expenseSmartEntryParser';
import type { Transaction, Supplier, LoanTracker, ExpenseCategory, Customer, HistoricalProfit, Employee } from '../types';
import EmployeeSalaryFields, { emptySalaryForm, salaryTotal, SalaryForm } from '../components/EmployeeSalaryFields';
import BulkSalaryModal from '../components/BulkSalaryModal';
import { calculateEmployeeLoans, calculateEmployeeAdvances, saveEmployeeSalaryPayment, voidEmployeeTransaction } from '../utils/employeePay';
import { useSaveGuard } from '../utils/useSaveGuard';

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
  isPostDated: boolean;
  clearsOn: string;
  transactionFee: string;
  settlement: SettlementAmounts;
  // Extra real-money lines on top of the main Mode above - e.g. paid partly
  // Cash and partly Mpesa, or Mpesa paid in several separate amounts. Empty
  // for a normal single-mode entry (the untouched, original save path is
  // used whenever this is empty).
  extraLines: { mode: 'cash' | 'mpesa' | 'paybill'; amount: string }[];
}

const emptyForm: ExpenseForm = {
  date: todayStr(),
  category: '',
  amount: '',
  mode: 'cash',
  description: '',
  notes: '',
  supplierId: '',
  loanId: '',
  partnerId: '',
  source: 'shop',
  isPostDated: false,
  clearsOn: '',
  transactionFee: '',
  settlement: emptySettlementAmounts,
  extraLines: [],
};

interface BulkExpenseRow {
  date: string;
  amount: string;
  mode: string;
  category: string;
  partnerId: string;
  source: 'shop' | 'own_pocket';
  description: string;
  isPostDated: boolean;
  clearsOn: string;
  transactionFee: string;
  // Only set on rows that came from Smart Entry and still have something
  // worth a second look before saving - never set on a manually-typed row.
  smartFlags?: string[];
}

const emptyBulkRow: BulkExpenseRow = {
  date: todayStr(),
  amount: '',
  mode: 'cash',
  category: '',
  partnerId: '',
  source: 'shop',
  description: '',
  isPostDated: false,
  clearsOn: '',
  transactionFee: '',
};

interface BulkSupplierPaymentRow {
  supplierId: string;
  amount: string;
  date: string;
  mode: string;
  notes: string;
  isPostDated: boolean;
  clearsOn: string;
  transactionFee: string;
  smartFlags?: string[];
  settlement: SettlementAmounts;
}

const emptyBulkSupplierRow: BulkSupplierPaymentRow = {
  supplierId: '',
  amount: '',
  date: todayStr(),
  mode: 'cash',
  notes: '',
  isPostDated: false,
  clearsOn: '',
  transactionFee: '',
  settlement: emptySettlementAmounts,
};

// A row parsed from a Smart Entry paste, before it's handed off to whichever
// tab's Bulk Entry actually saves it - Shop/Home/Supplier Bulk Entry each
// live on their own tab, so one paste's rows get split into these 3 groups.
interface ExpenseSmartPreviewRow {
  destination: 'shop' | 'home' | 'supplier';
  date: string;
  amount: string;
  mode: string;
  category: string;
  partnerId: string;
  source: 'shop' | 'own_pocket';
  supplierId: string;
  matchName: string;
  description: string;
  flags: string[];
}

export default function Expenses() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = usePersistentState<'shop' | 'home' | 'partners' | 'loans' | 'suppliers' | 'employees'>('expenses.activeTab', 'shop');
  const [expenses, setExpenses] = useState<Transaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loans, setLoans] = useState<LoanTracker[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [customersForLink, setCustomersForLink] = useState<Customer[]>([]);
  const [shareRules, setShareRules] = useState<ShareRule[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = usePersistentState('expenses.showAdd', false);
  const [editingId, setEditingId] = usePersistentState<string | null>('expenses.editingId', null);
  const [form, setForm] = usePersistentState<ExpenseForm>('expenses.form', emptyForm);
  const [search, setSearch] = usePersistentState('expenses.search', '');
  const [filterCategory, setFilterCategory] = usePersistentState('expenses.filterCategory', '');
  const [datePreset, setDatePreset] = usePersistentState<DatePreset>('expenses.datePreset', 'month');
  const [customFrom, setCustomFrom] = usePersistentState('expenses.customFrom', '');
  const [customTo, setCustomTo] = usePersistentState('expenses.customTo', '');
  const [expandedDates, setExpandedDates] = usePersistentState<Set<string>>('expenses.expandedDates', () => new Set());
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const [showBulk, setShowBulk] = usePersistentState('expenses.showBulk', false);
  const [bulkForms, setBulkForms] = usePersistentState<BulkExpenseRow[]>('expenses.bulkForms', () => Array.from({ length: 10 }, () => ({ ...emptyBulkRow })));
  // Parallel to bulkForms - set when this bulk form was reopened to edit a
  // past batch (see startEdit), so Save All knows which rows to update in
  // place instead of inserting as new expenses. Empty for a fresh bulk entry.
  const [bulkTxnIds, setBulkTxnIds] = usePersistentState<(string | null)[]>('expenses.bulkTxnIds', () => []);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showBulkSupplier, setShowBulkSupplier] = usePersistentState('expenses.showBulkSupplier', false);
  const [bulkSupplierForms, setBulkSupplierForms] = usePersistentState<BulkSupplierPaymentRow[]>('expenses.bulkSupplierForms', () => Array.from({ length: 10 }, () => ({ ...emptyBulkSupplierRow })));
  const [bulkSupplierTxnIds, setBulkSupplierTxnIds] = usePersistentState<(string | null)[]>('expenses.bulkSupplierTxnIds', () => []);
  const [bulkSupplierSaving, setBulkSupplierSaving] = useState(false);
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
  const [quickSupplier, setQuickSupplier] = useState({ name: '', phone: '', balance: '' });
  // Which Bulk Payments row has its quick-add mini-form open (null = none)
  const [bulkQuickAddSupplierRow, setBulkQuickAddSupplierRow] = useState<number | null>(null);
  const [showSmartEntry, setShowSmartEntry] = usePersistentState('expenses.showSmartEntry', false);
  const [smartEntryPaste, setSmartEntryPaste] = usePersistentState('expenses.smartEntryPaste', '');
  const [smartEntryPreview, setSmartEntryPreview] = usePersistentState<ExpenseSmartPreviewRow[]>('expenses.smartEntryPreview', () => []);
  // Which month/year to assume for Smart Entry dates that have no month in
  // them ("1ST"/"2ND"...) - defaults to the current month, but is editable so
  // pasting an older sheet after the month has moved on doesn't misdate everything.
  const [smartEntryMonth, setSmartEntryMonth] = usePersistentState('expenses.smartEntryMonth', () => todayStr().slice(0, 7));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { saving: savingExpense, guard: guardExpense } = useSaveGuard();
  const [showAddSalary, setShowAddSalary] = usePersistentState('expenses.showAddSalary', false);
  const [showBulkSalary, setShowBulkSalary] = useState(false);
  const [bulkSalaryEditDate, setBulkSalaryEditDate] = useState<string | null>(null);
  const [salaryForm, setSalaryForm] = usePersistentState<SalaryForm>('expenses.salaryForm', () => emptySalaryForm(todayStr()));
  const [savingSalary, setSavingSalary] = useState(false);

  useEffect(() => {
    fetchData();
    setSelectedIds(new Set());
  }, [activeTab, refreshKey]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    const match = allTransactions.find((t) => t.id === editId && t.type === 'expense');
    if (match) {
      setDatePreset('all');
      startEdit(match);
      setSearchParams({}, { replace: true });
    }
  }, [allTransactions, searchParams]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: suppData }, { data: loanData }, { data: catData }, { data: suppPayments }, { data: loanPayments }, { data: partnerDraws }, { data: fullTxns }, { data: custData }, { data: rules }, { data: hist }, { data: splitData }, { data: empData }] = await Promise.all([
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('type', 'expense').order('date', { ascending: false }).range(from, to)
      ),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('loan_trackers').select('*'),
      supabase.from('expense_categories').select('*').eq('is_active', true).order('name'),
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('type', 'supplier_payment').order('date', { ascending: false }).range(from, to)
      ),
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('type', 'loan_payment').order('date', { ascending: false }).range(from, to)
      ),
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('type', 'partner_draw').order('date', { ascending: false }).range(from, to)
      ),
      // Needed for the linked-partner settlement calc (Home Expenses Owed /
      // Profit Share Not Taken) - those scan ALL transaction types, not just
      // this tab's filtered slice.
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }).range(from, to)
      ),
      supabase.from('customers').select('*').eq('is_active', true),
      supabase.from('share_rules').select('*').eq('is_active', true),
      supabase.from('historical_profit').select('*'),
      supabase.from('transaction_splits').select('*'),
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
    ]);
    setAllTransactions(fullTxns || []);
    setEmployees(empData || []);
    setCustomersForLink(custData || []);
    setShareRules(rules || []);
    setHistoricalProfit(hist || []);
    setSplits(splitData || []);

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
    } else if (activeTab === 'partners') {
      filtered = partnerDraws || [];
    } else if (activeTab === 'employees') {
      filtered = (fullTxns || []).filter((t) => t.type === 'employee_salary');
    }

    setExpenses(filtered);
    setSuppliers(suppData || []);
    setLoans(loanData || []);
    setExpenseCategories(catData || []);
    setLoading(false);
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

  async function handleQuickAddSupplier() {
    const name = quickSupplier.name.trim();
    if (!name) { alert('Enter a name before saving.'); return; }
    if (suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      alert('A supplier with this name already exists.');
      return;
    }
    const openingBalance = parseFloat(quickSupplier.balance || '0');
    const { data } = await supabase.from('suppliers').insert({
      name,
      phone: quickSupplier.phone || null,
      balance: openingBalance,
    }).select().single();
    if (data) {
      if (openingBalance !== 0) {
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
      setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, supplierId: data.id }));
      setShowQuickAddSupplier(false);
      setQuickSupplier({ name: '', phone: '', balance: '' });
    }
  }

  // Same as the quick-add above, but for one specific Bulk Payments row instead
  // of the single Add form - the new supplier still becomes available to every
  // other row's dropdown right away too.
  async function handleBulkQuickAddSupplier(rowIndex: number) {
    const name = quickSupplier.name.trim();
    if (!name) { alert('Enter a name before saving.'); return; }
    if (suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      alert('A supplier with this name already exists.');
      return;
    }
    const openingBalance = parseFloat(quickSupplier.balance || '0');
    const { data } = await supabase.from('suppliers').insert({
      name,
      phone: quickSupplier.phone || null,
      balance: openingBalance,
    }).select().single();
    if (data) {
      if (openingBalance !== 0) {
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
      setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setBulkSupplierForms((prev) => {
        const next = [...prev];
        next[rowIndex] = { ...next[rowIndex], supplierId: data.id };
        return next;
      });
      setBulkQuickAddSupplierRow(null);
      setQuickSupplier({ name: '', phone: '', balance: '' });
    }
  }

  // Turns a paste of a monthly expenses sheet (Date "1ST"/"2ND".../Mode/Type/
  // Amount/Comment, no month or year) into preview rows split by destination -
  // Shop Expenses, Home Expenses, or Supplier Payments each live on their own
  // tab, so a single paste's rows get grouped for handing off to whichever
  // tab's Bulk Entry the user is on. Category and Supplier are guessed via a
  // fuzzy match against what already exists and always flagged for a check -
  // nothing here is saved until the user reviews it in that tab's Bulk Entry.
  function handleExpenseSmartEntryParse() {
    const parsed = parseExpenseSheetText(smartEntryPaste);
    const [yearStr, monthStr] = smartEntryMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const shopCats = expenseCategories.filter((c) => c.name !== 'home_expense' && c.name !== 'stock' && c.name !== 'supplier_payment');

    const preview: ExpenseSmartPreviewRow[] = parsed.map((r) => {
      const flags: string[] = [];
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;

      const modeLower = r.mode.toLowerCase();
      let mode = 'cash';
      if (modeLower === 'cash' || modeLower === 'mpesa' || modeLower === 'paybill') {
        mode = modeLower;
      } else if (r.mode) {
        flags.push(`Could not recognise mode "${r.mode}" - defaulted to Cash.`);
      } else {
        flags.push('No mode given - defaulted to Cash.');
      }

      if (r.type === 'SUPPLIERS') {
        let supplierId = '', matchName = '';
        const match = findBestMatch(r.comment, suppliers, (s) => s.name);
        if (match) {
          supplierId = match.item.id;
          matchName = match.item.name;
          flags.push(`Matched "${r.comment}" to supplier "${match.item.name}" - please confirm.`);
        } else {
          flags.push(`No matching supplier found for "${r.comment}" - please pick one.`);
        }
        return { destination: 'supplier', date: dateStr, amount: String(r.amount), mode, category: '', partnerId: '', source: 'shop', supplierId, matchName, description: r.comment, flags };
      }

      if (r.type === 'HOME EXPENSES') {
        flags.push('Home expense - defaulted to Taher, From Shop. Please confirm.');
        return { destination: 'home', date: dateStr, amount: String(r.amount), mode, category: '', partnerId: 'taher', source: 'shop', supplierId: '', matchName: '', description: r.comment, flags };
      }

      const isTaher = r.type.includes('TAHER');
      const isAbdulqadir = r.type.includes('ABDUL');
      if (isTaher || isAbdulqadir) {
        const partner = isTaher ? 'taher' : 'abdulqadir';
        flags.push(`Partner draw for ${partner} - please confirm.`);
        return { destination: 'shop', date: dateStr, amount: String(r.amount), mode, category: partner, partnerId: '', source: 'shop', supplierId: '', matchName: '', description: r.comment, flags };
      }

      // OUT or an unrecognised Type - treated as a Shop Expense either way.
      let category = '', matchName = '';
      const match = findBestMatch(r.comment, shopCats, (c) => c.name.replace(/_/g, ' '));
      if (match) {
        category = match.item.name;
        matchName = match.item.name.replace(/_/g, ' ');
        flags.push(`Matched "${r.comment}" to category "${matchName}" - please confirm.`);
      } else {
        flags.push(`No matching category found for "${r.comment}" - please pick or create one.`);
      }
      if (r.type !== 'OUT') flags.push(`Type "${r.type}" not recognised - treated as a Shop Expense.`);
      return { destination: 'shop', date: dateStr, amount: String(r.amount), mode, category, partnerId: '', source: 'shop', supplierId: '', matchName, description: r.comment, flags };
    });

    setSmartEntryPreview(preview);
  }

  // Loads whichever group of parsed rows matches the tab currently open -
  // Shop/Home/Supplier Bulk Entry each live on their own tab, so this gets
  // clicked once per tab to load that tab's share of the same paste.
  function handleAddExpenseSmartEntryToBulk() {
    if (activeTab === 'shop') {
      const rows = smartEntryPreview.filter((r) => r.destination === 'shop');
      if (rows.length === 0) { alert('No Shop Expense rows found in this paste.'); return; }
      setBulkForms(rows.map((r) => ({ ...emptyBulkRow, date: r.date, amount: r.amount, mode: r.mode, category: r.category, description: r.description, smartFlags: r.flags })));
      setBulkTxnIds([]);
      setShowBulk(true);
    } else if (activeTab === 'home') {
      const rows = smartEntryPreview.filter((r) => r.destination === 'home');
      if (rows.length === 0) { alert('No Home Expense rows found in this paste.'); return; }
      setBulkForms(rows.map((r) => ({ ...emptyBulkRow, date: r.date, amount: r.amount, mode: r.mode, partnerId: r.partnerId, source: r.source, description: r.description, smartFlags: r.flags })));
      setBulkTxnIds([]);
      setShowBulk(true);
    } else if (activeTab === 'suppliers') {
      const rows = smartEntryPreview.filter((r) => r.destination === 'supplier');
      if (rows.length === 0) { alert('No Supplier Payment rows found in this paste.'); return; }
      setBulkSupplierForms(rows.map((r) => ({ ...emptyBulkSupplierRow, date: r.date, amount: r.amount, mode: r.mode, supplierId: r.supplierId, notes: r.description, smartFlags: r.flags })));
      setBulkSupplierTxnIds([]);
      setShowBulkSupplier(true);
    } else {
      alert('Switch to the Shop Expenses, Home Expenses, or Supplier Payments tab first, then click this again to load that group.');
      return;
    }
    setShowSmartEntry(false);
  }

  async function handleSaveCategory() {
    if (!newCategoryName.trim()) { alert('Enter a Category Name before saving.'); return; }
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

  async function handleSave() {
    if (!form.amount || parseFloat(form.amount) <= 0) return;

    const amt = parseFloat(form.amount);

    // Handle supplier payment separately
    if (activeTab === 'suppliers') {
      if (!form.supplierId) {
        const keepEditing = confirm('No Supplier picked. Click OK to go back and pick one, or Cancel to close this form without saving.');
        if (!keepEditing) { setForm(emptyForm); setShowAdd(false); }
        return;
      }
      const supp = suppliers.find((s) => s.id === form.supplierId);
      if (!supp) return;

      const linkedPartnerId = supp.linked_partner_id;
      const linkedCustomer = linkedPartnerId ? customersForLink.find((c) => c.linked_partner_id === linkedPartnerId) : undefined;
      const settlementTotal = linkedPartnerId ? settlementAmountsTotal(form.settlement) : 0;
      const cashAmt = amt - settlementTotal;

      if (settlementTotal > amt) { alert('The settlement amounts add up to more than the total payment amount.'); return; }

      if (linkedPartnerId && settlementTotal > 0) {
        const available = computeSettlementAvailable(allTransactions, shareRules, historicalProfit, linkedPartnerId, linkedCustomer?.credit_balance || 0);
        const warnings = findSettlementOverflows(form.settlement, available, "Mohamedi's Customer Balance");
        if (warnings.length > 0 && !confirm(warnings.join('\n\n') + '\n\nContinue?')) return;
      }

      const { data: newTxn, error } = await insertTransactionWithId('SUP-' + form.date.replace(/-/g, ''), (txnId) => ({
        transaction_id: txnId,
        date: form.date,
        type: 'supplier_payment',
        primary_mode: cashAmt > 0 ? form.mode : null,
        amount: amt,
        supplier_id: form.supplierId,
        description: form.description || `Payment to ${supp.name}`,
        notes: form.notes || null,
        clears_on: form.mode === 'paybill' && form.isPostDated && form.clearsOn ? form.clearsOn : null,
        created_by: user?.username || null,
      }));
      if (error || !newTxn) { console.error(error); alert('Failed to save payment: ' + (error?.message || 'unknown error')); return; }
      await adjustSupplierBalance(form.supplierId, -amt);

      const splitRows: { transaction_id: string; mode: string; amount: number }[] = [];
      if (cashAmt > 0) splitRows.push({ transaction_id: newTxn.transaction_id, mode: form.mode, amount: cashAmt });
      if (linkedPartnerId && settlementTotal > 0) {
        const ctx = {
          partnerId: linkedPartnerId,
          date: form.date,
          createdBy: user?.username || null,
          refLabel: supp.name,
          primaryTransactionId: newTxn.transaction_id,
          crossPartyId: linkedCustomer?.id || null,
          crossPartyRole: 'customer' as const,
        };
        for (const { key, mode } of SETTLEMENT_MODE_KEYS) {
          const srcAmount = parseFloat(form.settlement[key] || '0') || 0;
          if (srcAmount > 0) {
            splitRows.push({ transaction_id: newTxn.transaction_id, mode, amount: srcAmount });
            await applySettlementSource(mode, srcAmount, ctx);
          }
        }
      }
      if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);

      if (cashAmt > 0) await insertTransactionFee(form.date, form.mode, form.transactionFee, supp.name);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    // Handle loan payment separately
    if (activeTab === 'loans') {
      if (!form.loanId) {
        const keepEditing = confirm('No Loan picked. Click OK to go back and pick one, or Cancel to close this form without saving.');
        if (!keepEditing) { setForm(emptyForm); setShowAdd(false); }
        return;
      }
      const loan = loans.find((l) => l.id === form.loanId);
      if (!loan) return;

      const { data: newTxn, error } = await insertTransactionWithId('LOAN-' + form.date.replace(/-/g, ''), (txnId) => ({
        transaction_id: txnId,
        date: form.date,
        type: 'loan_payment',
        primary_mode: form.mode,
        amount: amt,
        loan_id: form.loanId,
        description: form.description || `Payment for ${loan.loan_name}`,
        notes: form.notes || null,
        created_by: user?.username || null,
      }));
      if (error || !newTxn) { console.error(error); alert('Failed to save payment: ' + (error?.message || 'unknown error')); return; }
      // Update loan balance
      await adjustLoanBalance(form.loanId, amt);
      await insertTransactionFee(form.date, form.mode, form.transactionFee, loan.loan_name);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    // Handle partner draw separately
    if (activeTab === 'partners') {
      if (!form.partnerId) {
        const keepEditing = confirm('No Partner picked. Click OK to go back and pick one, or Cancel to close this form without saving.');
        if (!keepEditing) { setForm(emptyForm); setShowAdd(false); }
        return;
      }

      const { data: newTxn, error } = await insertTransactionWithId('DRW-' + form.date.replace(/-/g, ''), (txnId) => ({
        transaction_id: txnId,
        date: form.date,
        type: 'partner_draw',
        primary_mode: form.mode,
        amount: amt,
        partner_id: form.partnerId,
        description: form.description || `Partner draw - ${form.partnerId}`,
        notes: form.notes || null,
        created_by: user?.username || null,
      }));
      if (error || !newTxn) { console.error(error); alert('Failed to save partner draw: ' + (error?.message || 'unknown error')); return; }
      await insertTransactionFee(form.date, form.mode, form.transactionFee, form.partnerId);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    const isHomeExpense = activeTab === 'home';
    const category = isHomeExpense ? 'home_expense' : form.category;

    // Check if partner expense category
    const isPartnerExpense = category === 'taher' || category === 'abdulqadir';

    // Extra Payment Lines split a real-money expense across more than one
    // mode (or the same mode more than once) - not offered for an "Own
    // Pocket" home expense since that's never real cash to begin with.
    const usesExtraLines = form.extraLines.length > 0 && !(isHomeExpense && form.source === 'own_pocket');
    if (usesExtraLines && form.extraLines.some((l) => parseFloat(l.amount || '0') <= 0)) {
      alert('Every extra payment line needs an amount before saving - remove any empty ones.');
      return;
    }
    const extraTotal = usesExtraLines ? form.extraLines.reduce((s, l) => s + (parseFloat(l.amount || '0') || 0), 0) : 0;
    const mainAmt = amt - extraTotal;
    if (usesExtraLines && mainAmt < -0.01) {
      alert(`Extra payment lines (KES ${extraTotal.toLocaleString()}) add up to more than the total Amount (KES ${amt.toLocaleString()}).`);
      return;
    }

    const { data: newTxn, error } = await insertTransactionWithId('EXP-' + form.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: form.date,
      type: isPartnerExpense ? 'partner_draw' : 'expense',
      primary_mode: usesExtraLines ? 'split' : (isHomeExpense && form.source === 'own_pocket' ? null : form.mode),
      amount: amt,
      category,
      description: form.description || null,
      notes: isHomeExpense ? `From ${form.source === 'own_pocket' ? 'Own Pocket' : 'Shop'}${form.notes ? ' | ' + form.notes : ''}` : (form.notes || null),
      supplier_id: form.supplierId || null,
      loan_id: form.loanId || null,
      partner_id: isPartnerExpense ? category : (isHomeExpense ? form.partnerId || null : null),
      clears_on: !usesExtraLines && form.mode === 'paybill' && form.isPostDated && form.clearsOn ? form.clearsOn : null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save expense: ' + (error?.message || 'unknown error')); return; }

    if (usesExtraLines) {
      const splitRows: { transaction_id: string; mode: string; amount: number }[] = [];
      if (mainAmt > 0.01) splitRows.push({ transaction_id: newTxn.transaction_id, mode: form.mode, amount: mainAmt });
      form.extraLines.forEach((l) => splitRows.push({ transaction_id: newTxn.transaction_id, mode: l.mode, amount: parseFloat(l.amount) }));
      if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);
    }

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

    await insertTransactionFee(form.date, form.mode, form.transactionFee, form.description || category);

    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
  }

  // Only used for the Shop Expenses and Home Expenses tabs - suppliers/loans/partners
  // payments each need a picked record (loan, supplier) that doesn't fit a fast
  // multi-row entry flow the way plain expenses do.
  async function handleBulkSave() {
    if (bulkSaving) return;
    const isHomeExpense = activeTab === 'home';
    const validForms = bulkForms
      .map((f, originalIndex) => ({ f, originalIndex }))
      .filter(({ f }) => f.amount && parseFloat(f.amount) > 0);
    if (validForms.length === 0) return;
    setBulkSaving(true);
    try {
      const failedRows: number[] = [];

      for (let i = 0; i < validForms.length; i++) {
        const { f, originalIndex } = validForms[i];
        const amt = parseFloat(f.amount);
        const category = isHomeExpense ? 'home_expense' : f.category;
        const isPartnerExpense = !isHomeExpense && (category === 'taher' || category === 'abdulqadir');
        const existingTxnId = bulkTxnIds[originalIndex];

        const payload = {
          date: f.date,
          type: isPartnerExpense ? 'partner_draw' : 'expense',
          primary_mode: isHomeExpense && f.source === 'own_pocket' ? null : f.mode,
          amount: amt,
          category,
          description: f.description || null,
          notes: isHomeExpense ? `From ${f.source === 'own_pocket' ? 'Own Pocket' : 'Shop'}` : null,
          partner_id: isPartnerExpense ? category : (isHomeExpense ? f.partnerId || null : null),
          clears_on: f.mode === 'paybill' && f.isPostDated && f.clearsOn ? f.clearsOn : null,
        };

        if (existingTxnId) {
          const { error } = await supabase.from('transactions').update({ ...payload, edited_at: new Date().toISOString() }).eq('id', existingTxnId);
          if (error) { console.error(error); failedRows.push(originalIndex + 1); }
          continue;
        }

        const { data: newTxn, error } = await insertTransactionWithId('EXP-' + f.date.replace(/-/g, ''), (txnId) => ({
          transaction_id: txnId,
          ...payload,
          created_by: user?.username || null,
        }));
        if (error || !newTxn) { console.error(error); failedRows.push(originalIndex + 1); continue; }
        await insertTransactionFee(f.date, f.mode, f.transactionFee, f.description || category);
      }

      setBulkForms(Array.from({ length: 10 }, () => ({ ...emptyBulkRow, date: todayStr() })));
      setBulkTxnIds([]);
      setShowBulk(false);
      fetchData();
      triggerRefresh();
      if (failedRows.length > 0) {
        alert(`Row(s) ${failedRows.join(', ')} failed to save and were skipped. The rest were saved successfully.`);
      }
    } finally {
      setBulkSaving(false);
    }
  }

  // Unlike the single "Add Supplier Payment" form (one payment, one supplier
  // picked at a time), each row here picks its own supplier - for logging
  // payments to many different suppliers in one sitting.
  async function handleBulkSupplierSave() {
    if (bulkSupplierSaving) return;
    const noSupplierRows: number[] = [];
    const validForms = bulkSupplierForms
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
    setBulkSupplierSaving(true);
    try {
      const failedRows: number[] = [];
      const savedDates = new Set<string>();

      for (let i = 0; i < validForms.length; i++) {
        const { f, originalIndex } = validForms[i];
        const amt = parseFloat(f.amount);
        const supplier = suppliers.find((s) => s.id === f.supplierId);
        if (!supplier) { failedRows.push(originalIndex + 1); continue; }
        const existingTxnId = bulkSupplierTxnIds[originalIndex];

        // Rows reopened from a past batch never carry a settlement split (see
        // startEdit - a row with one is left out of the reopened batch), so
        // updating one is just its own plain fields plus the balance delta.
        if (existingTxnId) {
          const existing = allTransactions.find((t) => t.id === existingTxnId);
          if (!existing) { failedRows.push(originalIndex + 1); continue; }
          const { error } = await supabase.from('transactions').update({
            date: f.date,
            primary_mode: f.mode,
            amount: amt,
            supplier_id: f.supplierId,
            notes: f.notes || null,
            clears_on: f.mode === 'paybill' && f.isPostDated && f.clearsOn ? f.clearsOn : null,
            edited_at: new Date().toISOString(),
          }).eq('id', existingTxnId);
          if (error) { console.error(error); failedRows.push(originalIndex + 1); continue; }
          savedDates.add(f.date);
          const delta = amt - (existing.amount || 0);
          if (delta !== 0 || existing.supplier_id !== f.supplierId) {
            if (existing.supplier_id) await adjustSupplierBalance(existing.supplier_id, existing.amount || 0);
            await adjustSupplierBalance(f.supplierId, -amt);
          }
          continue;
        }

        const linkedPartnerId = supplier.linked_partner_id;
        const linkedCustomer = linkedPartnerId ? customersForLink.find((c) => c.linked_partner_id === linkedPartnerId) : undefined;
        const settlementTotal = linkedPartnerId ? settlementAmountsTotal(f.settlement) : 0;
        const cashAmt = amt - settlementTotal;
        if (settlementTotal > amt) { failedRows.push(originalIndex + 1); continue; }

        const { data: newTxn, error } = await insertTransactionWithId('SUP-' + f.date.replace(/-/g, ''), (txnId) => ({
          transaction_id: txnId,
          date: f.date,
          type: 'supplier_payment',
          primary_mode: cashAmt > 0 ? f.mode : null,
          amount: amt,
          supplier_id: f.supplierId,
          description: `Payment to ${supplier.name}`,
          notes: f.notes || null,
          clears_on: f.mode === 'paybill' && f.isPostDated && f.clearsOn ? f.clearsOn : null,
          created_by: user?.username || null,
        }));
        if (error || !newTxn) { console.error(error); failedRows.push(originalIndex + 1); continue; }
        savedDates.add(f.date);
        await adjustSupplierBalance(f.supplierId, -amt);

        const splitRows: { transaction_id: string; mode: string; amount: number }[] = [];
        if (cashAmt > 0) splitRows.push({ transaction_id: newTxn.transaction_id, mode: f.mode, amount: cashAmt });
        if (linkedPartnerId && settlementTotal > 0) {
          const ctx = {
            partnerId: linkedPartnerId,
            date: f.date,
            createdBy: user?.username || null,
            refLabel: supplier.name,
            primaryTransactionId: newTxn.transaction_id,
            crossPartyId: linkedCustomer?.id || null,
            crossPartyRole: 'customer' as const,
          };
          for (const { key, mode } of SETTLEMENT_MODE_KEYS) {
            const srcAmount = parseFloat(f.settlement[key] || '0') || 0;
            if (srcAmount > 0) {
              splitRows.push({ transaction_id: newTxn.transaction_id, mode, amount: srcAmount });
              await applySettlementSource(mode, srcAmount, ctx);
            }
          }
        }
        if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);

        if (cashAmt > 0) await insertTransactionFee(f.date, f.mode, f.transactionFee, supplier.name);
      }

      setBulkSupplierForms(Array.from({ length: 10 }, () => ({ ...emptyBulkSupplierRow, date: todayStr() })));
      setBulkSupplierTxnIds([]);
      setShowBulkSupplier(false);
      // Make what was just saved immediately visible - not buried under a
      // collapsed date row, or invisible because the date filter doesn't
      // happen to cover it.
      if (savedDates.size > 0) {
        const nextExpanded = new Set(expandedDates);
        savedDates.forEach((d) => nextExpanded.add(d));
        setExpandedDates(nextExpanded);
        setDatePreset('all');
        setCustomFrom('');
        setCustomTo('');
      }
      fetchData();
      triggerRefresh();
      if (failedRows.length > 0) {
        alert(`Row(s) ${failedRows.join(', ')} failed to save and were skipped. The rest were saved successfully.`);
      }
    } finally {
      setBulkSupplierSaving(false);
    }
  }

  // Reverses whatever balance this entry affected and marks it void - shared
  // by the single Void button and Bulk Delete, which just calls this once per
  // selected row and does the fetch/refresh a single time at the end.
  async function voidOne(id: string, reason: string) {
    const txn = expenses.find((e) => e.id === id);
    if (!txn) return true;

    // Reverse supplier balance - covers a supplier-payment TYPE transaction (paid via
    // the Suppliers tab) as well as a stock/supplier_payment CATEGORY expense
    if (txn.supplier_id && (txn.type === 'supplier_payment' || txn.category === 'supplier_payment' || txn.category === 'stock')) {
      await adjustSupplierBalance(txn.supplier_id, txn.amount || 0);
      if (txn.type === 'supplier_payment') await undoSettlementForTransaction(txn.transaction_id, txn.supplier_id, null);
    }

    // Reverse loan balance
    if (txn.loan_id) {
      await adjustLoanBalance(txn.loan_id, -(txn.amount || 0));
    }

    const { error } = await supabase.from('transactions').update({ is_void: true, void_reason: reason }).eq('id', id);
    if (error) { console.error(error); return false; }
    return true;
  }

  async function handleVoid(id: string, reason: string) {
    const ok = await voidOne(id, reason);
    if (!ok) { alert('Failed to void'); return; }
    fetchData();
    triggerRefresh();
  }

  async function handleBulkVoid() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected entrie(s)? This will reverse any balance changes.`)) return;
    let failedCount = 0;
    for (const id of selectedIds) {
      const ok = await voidOne(id, 'Bulk delete');
      if (!ok) failedCount++;
    }
    setSelectedIds(new Set());
    fetchData();
    triggerRefresh();
    if (failedCount > 0) {
      alert(`${failedCount} entrie(s) failed to delete. The rest were deleted successfully.`);
    }
  }

  function startEdit(expense: Transaction) {
    const isHome = expense.category === 'home_expense';
    const isPartner = expense.type === 'partner_draw';

    // A Shop/Home expense entered through Bulk Entry reopens as that same
    // batch (every expense saved alongside it, found via findBulkBatch)
    // instead of one row at a time - matches how it was actually entered.
    // A batch mixing plain expenses with partner-category rows (saved as
    // their own partner_draw type) only regroups the expense rows here -
    // rare enough not to chase further. An expense paid across more than
    // one payment line (Extra Payment Line) is left out, same as the
    // Supplier Payment settlement-split guard below - this simple bulk form
    // can't reconstruct/edit that breakdown.
    const hasSplitLines = (t: Transaction) => t.primary_mode === 'split' && splits.some((sp) => sp.transaction_id === t.transaction_id);
    if (expense.type === 'expense' && !isPartner && !hasSplitLines(expense)) {
      const batch = findBulkBatch(allTransactions, expense, 'expense')
        .filter((t) => (t.category === 'home_expense') === isHome)
        .filter((t) => !hasSplitLines(t));
      if (batch.length > 1) {
        const sorted = [...batch].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        setBulkForms(sorted.map((b) => ({
          date: b.date,
          amount: String(b.amount || ''),
          mode: b.primary_mode || 'cash',
          category: isHome ? '' : (b.category || ''),
          partnerId: b.partner_id || '',
          source: (b.notes?.includes('Own Pocket') ? 'own_pocket' : 'shop') as 'shop' | 'own_pocket',
          description: b.description || '',
          isPostDated: !!b.clears_on,
          clearsOn: b.clears_on || '',
          transactionFee: '',
        })));
        setBulkTxnIds(sorted.map((b) => b.id));
        setActiveTab(isHome ? 'home' : 'shop');
        setShowBulk(true);
        return;
      }
    }

    // Same idea for a Supplier Payment entered through Bulk Payments - but a
    // payment settled via Home Expenses Owed/Profit Share/cross-balance
    // leaves a transaction_splits row this simple form can't reconstruct, so
    // any row with one (this one included) is left out and still opens
    // single, same as handleUpdate's own guard for that case below.
    if (expense.type === 'supplier_payment' && !splits.some((sp) => sp.transaction_id === expense.transaction_id)) {
      const batch = findBulkBatch(allTransactions, expense, 'supplier_payment')
        .filter((t) => !splits.some((sp) => sp.transaction_id === t.transaction_id));
      if (batch.length > 1) {
        const sorted = [...batch].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        setBulkSupplierForms(sorted.map((b) => ({
          supplierId: b.supplier_id || '',
          amount: String(b.amount || ''),
          date: b.date,
          mode: b.primary_mode || 'cash',
          notes: b.notes || '',
          isPostDated: !!b.clears_on,
          clearsOn: b.clears_on || '',
          transactionFee: '',
          settlement: emptySettlementAmounts,
        })));
        setBulkSupplierTxnIds(sorted.map((b) => b.id));
        setActiveTab('suppliers');
        setShowBulkSupplier(true);
        return;
      }
    }

    setEditingId(expense.id);
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
      isPostDated: !!expense.clears_on,
      clearsOn: expense.clears_on || '',
      transactionFee: '',
      settlement: emptySettlementAmounts,
      extraLines: [],
    });
    if (expense.type === 'supplier_payment') setActiveTab('suppliers');
    else if (expense.type === 'loan_payment') setActiveTab('loans');
    else if (isPartner) setActiveTab('partners');
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
      if (splits.some((sp) => sp.transaction_id === oldTxn.transaction_id)) {
        alert('This payment was settled using more than one source (cash and/or Home Expenses Owed / Profit Share / other balance) - it can\'t be edited here. Void and re-enter it instead.');
        return;
      }
      if (oldTxn.supplier_id) await adjustSupplierBalance(oldTxn.supplier_id, oldTxn.amount || 0);
      const { error } = await supabase.from('transactions').update({
        date: form.date,
        primary_mode: form.mode,
        amount: amt,
        supplier_id: form.supplierId || null,
        description: form.description || null,
        notes: form.notes || null,
        clears_on: form.mode === 'paybill' && form.isPostDated && form.clearsOn ? form.clearsOn : null,
        edited_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (error) { alert('Failed to save: ' + error.message); return; }
      if (form.supplierId) await adjustSupplierBalance(form.supplierId, -amt);

      setEditingId(null);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    if (oldTxn.type === 'partner_draw') {
      const { error } = await supabase.from('transactions').update({
        date: form.date,
        primary_mode: form.mode,
        amount: amt,
        partner_id: form.partnerId || oldTxn.partner_id,
        description: form.description || `Partner draw - ${form.partnerId || oldTxn.partner_id}`,
        notes: form.notes || null,
        edited_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (error) { alert('Failed to save: ' + error.message); return; }

      setEditingId(null);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    if (oldTxn.type === 'loan_payment') {
      if (oldTxn.loan_id) await adjustLoanBalance(oldTxn.loan_id, -(oldTxn.amount || 0));
      const { error } = await supabase.from('transactions').update({
        date: form.date,
        primary_mode: form.mode,
        amount: amt,
        loan_id: form.loanId || null,
        description: form.description || null,
        notes: form.notes || null,
        edited_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (error) { alert('Failed to save: ' + error.message); return; }
      if (form.loanId) await adjustLoanBalance(form.loanId, amt);

      setEditingId(null);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    // A plain expense saved with more than one payment line (Extra Payment
    // Lines) can't be safely collapsed back to a single mode/amount by this
    // form - void and re-enter it instead, same guard as supplier_payment
    // above.
    if (oldTxn.primary_mode === 'split' && splits.some((sp) => sp.transaction_id === oldTxn.transaction_id)) {
      alert('This expense was paid across more than one payment line - it can\'t be edited here. Void and re-enter it instead.');
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
    const { error } = await supabase.from('transactions').update({
      date: form.date,
      primary_mode: isHomeExpense && form.source === 'own_pocket' ? null : form.mode,
      amount: amt,
      category,
      description: form.description || null,
      notes: isHomeExpense ? `From ${form.source === 'own_pocket' ? 'Own Pocket' : 'Shop'}${form.notes ? ' | ' + form.notes : ''}` : (form.notes || null),
      supplier_id: form.supplierId || null,
      loan_id: form.loanId || null,
      partner_id: isPartnerExpense ? category : (isHomeExpense ? form.partnerId || null : null),
      type: isPartnerExpense ? 'partner_draw' : 'expense',
      clears_on: form.mode === 'paybill' && form.isPostDated && form.clearsOn ? form.clearsOn : null,
      edited_at: new Date().toISOString(),
    }).eq('id', editingId);
    if (error) { alert('Failed to save: ' + error.message); return; }

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

  const { from: rangeFrom, to: rangeTo } = getDatePresetRange(datePreset, customFrom, customTo);
  const grouped = new Map<string, Transaction[]>();
  const filtered = expenses.filter((e) => {
    if (e.is_void) return false;
    if (search && !e.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && e.category !== filterCategory) return false;
    if (e.date < rangeFrom || e.date > rangeTo) return false;
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

  function addBulkRow() {
    setBulkForms([...bulkForms, { ...emptyBulkRow, date: bulkForms[0]?.date || todayStr() }]);
  }

  function addBulkSupplierRow() {
    setBulkSupplierForms([...bulkSupplierForms, { ...emptyBulkSupplierRow, date: bulkSupplierForms[0]?.date || todayStr() }]);
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit flex-wrap">
        {(['shop', 'home', 'partners', 'suppliers', 'loans', 'employees'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setShowAdd(false); setEditingId(null); setShowBulk(false); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'shop' ? 'Shop Expenses' : tab === 'home' ? 'Home Expenses' : tab === 'partners' ? 'Partners' : tab === 'suppliers' ? 'Supplier Payments' : tab === 'loans' ? 'Loans' : 'Employees'}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {activeTab === 'employees' ? (
          <>
            <button
              onClick={() => { setShowAddSalary(true); setSalaryForm(emptySalaryForm(todayStr())); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <Plus size={16} /> Pay Salary
            </button>
            <button onClick={() => setShowBulkSalary(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              <Plus size={16} /> Bulk Pay Salaries
            </button>
            <button onClick={() => navigate('/employees')} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              Manage Employees / Loans / Advances
            </button>
          </>
        ) : (
          <button
            onClick={() => { setShowAdd(true); setEditingId(null); setForm({ ...emptyForm, date: todayStr(), partnerId: user?.username === 'taher' ? 'taher' : user?.username === 'abdulqadir' ? 'abdulqadir' : '' }); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} /> Add {activeTab === 'shop' ? 'Expense' : activeTab === 'home' ? 'Home Expense' : activeTab === 'partners' ? 'Partner Draw' : activeTab === 'suppliers' ? 'Supplier Payment' : 'Loan Payment'}
          </button>
        )}
        {(activeTab === 'shop' || activeTab === 'home') && (
          <button
            onClick={() => { setShowBulk(true); setBulkForms(Array.from({ length: 10 }, () => ({ ...emptyBulkRow, date: todayStr() }))); setBulkTxnIds([]); }}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} /> Bulk Entry
          </button>
        )}
        {activeTab === 'suppliers' && (
          <button
            onClick={() => { setShowBulkSupplier(true); setBulkSupplierForms(Array.from({ length: 10 }, () => ({ ...emptyBulkSupplierRow, date: todayStr() }))); setBulkSupplierTxnIds([]); }}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} /> Bulk Payments
          </button>
        )}
        {(activeTab === 'shop' || activeTab === 'home' || activeTab === 'suppliers') && (
          <button
            onClick={() => setShowSmartEntry(!showSmartEntry)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} /> Smart Entry
          </button>
        )}
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

      <div className="bg-white p-3 rounded-lg border border-slate-200">
        <DateFilterBar
          preset={datePreset}
          customFrom={customFrom}
          customTo={customTo}
          onChange={(p, from, to) => { setDatePreset(p); setCustomFrom(from); setCustomTo(to); }}
        />
      </div>

      {/* Smart Entry - paste a monthly expenses sheet, review the parsed rows
          here, then hand each group off to its own tab's Bulk Entry (already
          filled in) for the real editing and Save All. */}
      {showSmartEntry && (
        <div
          className="bg-white rounded-xl border border-slate-200 shadow-lg p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowSmartEntry(false); }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Smart Entry</h3>
            <button onClick={() => setShowSmartEntry(false)} className="p-1 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-2">
            Paste rows copied from a monthly expenses sheet (Date/Mode/Type/Amount/Comment). Dates like "1ST"/"2ND" have no month in them - pick which month this paste is for below. Nothing is saved until you send each group to its tab's Bulk Entry and press Save All there.
          </p>
          <div className="mb-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Which month is this for?</label>
            <input
              type="month"
              value={smartEntryMonth}
              onChange={(e) => setSmartEntryMonth(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <textarea
            value={smartEntryPaste}
            onChange={(e) => setSmartEntryPaste(e.target.value)}
            placeholder="Paste your expenses sheet here..."
            rows={8}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleExpenseSmartEntryParse}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium"
            >
              Parse pasted rows
            </button>
            <button
              onClick={() => { setSmartEntryPaste(''); setSmartEntryPreview([]); }}
              className="text-slate-500 hover:text-slate-700 text-sm"
            >
              Clear
            </button>
            {smartEntryPreview.length > 0 && (
              <span className="text-xs text-slate-500 ml-auto">
                {smartEntryPreview.length} parsed: {smartEntryPreview.filter((r) => r.destination === 'shop').length} Shop, {smartEntryPreview.filter((r) => r.destination === 'home').length} Home, {smartEntryPreview.filter((r) => r.destination === 'supplier').length} Supplier
              </span>
            )}
          </div>

          {smartEntryPreview.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 max-h-96 overflow-y-auto">
              {smartEntryPreview.map((r, i) => (
                <div key={i} className="border border-amber-300 bg-amber-50 rounded p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 capitalize">{r.destination}</span>
                    <span className="font-medium text-slate-700">{r.date}</span>
                    <span className="text-slate-500">KES {formatKES(parseFloat(r.amount))}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 capitalize">{r.mode}</span>
                    {r.matchName && <span className="text-slate-500">→ {r.matchName}</span>}
                    {r.category && !r.matchName && <span className="text-slate-500">→ {r.category}</span>}
                  </div>
                  {r.flags.length > 0 && (
                    <ul className="text-amber-700 list-disc list-inside space-y-0.5">
                      {r.flags.map((f, fi) => <li key={fi}>{f}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {smartEntryPreview.length > 0 && (
            <div className="flex gap-3 mt-3 pt-3 border-t border-slate-200">
              <button
                onClick={handleAddExpenseSmartEntryToBulk}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium"
              >
                Add to Bulk Entry ({activeTab === 'shop' ? smartEntryPreview.filter((r) => r.destination === 'shop').length : activeTab === 'home' ? smartEntryPreview.filter((r) => r.destination === 'home').length : activeTab === 'suppliers' ? smartEntryPreview.filter((r) => r.destination === 'supplier').length : 0} on this tab) →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal - a real popup, so it's visible no matter how far down the page you've scrolled */}
      {showAddSalary && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setShowAddSalary(false); }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md max-h-[90vh] overflow-y-auto" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Pay Salary</h3>
              <button onClick={() => setShowAddSalary(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <EmployeeSalaryFields employees={employees} transactions={allTransactions} form={salaryForm} onChange={setSalaryForm} showEmployeePicker />
            <button
              onClick={async () => {
                if (savingSalary) return;
                const emp = employees.find((e) => e.id === salaryForm.employeeId);
                if (!emp) { alert('Pick an employee'); return; }
                const total = salaryTotal(salaryForm);
                if (total < 0) { alert('Loan/advance deductions add up to more than the salary and commission.'); return; }
                setSavingSalary(true);
                try {
                  const activeLoan = calculateEmployeeLoans(allTransactions, emp.id).find((l) => l.remaining > 0);
                  const activeAdvance = calculateEmployeeAdvances(allTransactions, emp.id).find((a) => a.remaining > 0);
                  const result = await saveEmployeeSalaryPayment({
                    employeeId: emp.id,
                    date: salaryForm.date,
                    salaryAmount: parseFloat(salaryForm.amount || '0') || 0,
                    commission: parseFloat(salaryForm.commission || '0') || 0,
                    loanDeduction: parseFloat(salaryForm.loanDeduction || '0') || 0,
                    loanOutstanding: activeLoan?.remaining || 0,
                    loanActiveRef: activeLoan?.transactionId || null,
                    advanceDeduction: parseFloat(salaryForm.advanceDeduction || '0') || 0,
                    advanceOutstanding: activeAdvance?.remaining || 0,
                    advanceActiveRef: activeAdvance?.transactionId || null,
                    daysWorked: salaryForm.daysWorked ? parseInt(salaryForm.daysWorked, 10) : null,
                    mode: salaryForm.mode,
                    notes: salaryForm.notes || null,
                    createdBy: user?.username || null,
                  });
                  if (!result.ok) { alert(result.error); return; }
                  setSalaryForm(emptySalaryForm(todayStr()));
                  setShowAddSalary(false);
                  fetchData();
                  triggerRefresh();
                } finally {
                  setSavingSalary(false);
                }
              }}
              disabled={savingSalary}
              className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium"
            >
              {savingSalary ? 'Saving...' : 'Save Payment'}
            </button>
          </div>
        </div>
      )}

      {showBulkSalary && (
        <BulkSalaryModal
          employees={employees}
          transactions={allTransactions}
          createdBy={user?.username || null}
          editDate={bulkSalaryEditDate || undefined}
          onClose={() => { setShowBulkSalary(false); setBulkSalaryEditDate(null); }}
          onSaved={() => { setShowBulkSalary(false); setBulkSalaryEditDate(null); fetchData(); triggerRefresh(); }}
        />
      )}

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowAdd(false); setEditingId(null); } }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">
              {editingId ? 'Edit' : 'Add'} {activeTab === 'shop' ? 'Expense' : activeTab === 'home' ? 'Home Expense' : activeTab === 'partners' ? 'Partner Draw' : activeTab === 'suppliers' ? 'Supplier Payment' : 'Loan Payment'}
            </h3>
            <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="p-1 hover:bg-slate-100 rounded">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-2">
            {/* Row 1: Date, Amount, Mode - no mode for "Own Pocket" home expenses,
                since it's the partner's own money and no shop wallet is involved */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                placeholder="Amount"
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              {activeTab === 'home' && form.source === 'own_pocket' ? (
                <div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-xs text-slate-500 flex items-center">No mode - own money</div>
              ) : (
                <select
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">Mpesa</option>
                  <option value="paybill">Paybill</option>
                </select>
              )}
            </div>

            {/* Transaction fee (Mpesa/Paybill only lose money to network fees; only offered on new entries) */}
            {!editingId && (form.mode === 'mpesa' || form.mode === 'paybill') && (
              <input
                type="number"
                value={form.transactionFee}
                onChange={(e) => setForm({ ...form, transactionFee: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                placeholder="Transaction fee (optional)"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            )}

            {/* Post-dated cheque (only makes sense for Paybill/Bank) */}
            {form.mode === 'paybill' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPostDated"
                  checked={form.isPostDated}
                  onChange={(e) => setForm({ ...form, isPostDated: e.target.checked })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="isPostDated" className="text-xs text-slate-600">Post-dated cheque</label>
                {form.isPostDated && (
                  <input
                    type="date"
                    value={form.clearsOn}
                    onChange={(e) => setForm({ ...form, clearsOn: e.target.value })}
                    onKeyDown={(e) => handleFormKeyNav(e)}
                    className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                    placeholder="Clears on"
                  />
                )}
              </div>
            )}

            {/* Extra payment lines - e.g. paid partly Cash and partly Mpesa,
                or Mpesa paid in several separate amounts. Not offered for an
                "Own Pocket" home expense (no mode involved), or while
                editing (a saved multi-line entry is voided and re-entered
                instead, not edited in place). */}
            {!editingId && (activeTab === 'shop' || (activeTab === 'home' && form.source !== 'own_pocket')) && (
              <div className="space-y-1.5 border border-slate-200 rounded p-2">
                <p className="text-xs font-medium text-slate-600">Extra payment lines (optional)</p>
                {form.extraLines.map((line, idx) => (
                  <div key={idx} className="flex gap-1.5 items-center">
                    <select
                      value={line.mode}
                      onChange={(e) => {
                        const extraLines = [...form.extraLines];
                        extraLines[idx] = { ...extraLines[idx], mode: e.target.value as 'cash' | 'mpesa' | 'paybill' };
                        setForm({ ...form, extraLines });
                      }}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="cash">Cash</option>
                      <option value="mpesa">Mpesa</option>
                      <option value="paybill">Paybill</option>
                    </select>
                    <input
                      type="number"
                      value={line.amount}
                      onChange={(e) => {
                        const extraLines = [...form.extraLines];
                        extraLines[idx] = { ...extraLines[idx], amount: e.target.value };
                        setForm({ ...form, extraLines });
                      }}
                      placeholder="Amount"
                      className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, extraLines: form.extraLines.filter((_, i) => i !== idx) })}
                      className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, extraLines: [...form.extraLines, { mode: 'cash', amount: '' }] })}
                  className="text-xs text-emerald-700 hover:text-emerald-800 font-medium"
                >
                  + Add another payment line
                </button>
              </div>
            )}

            {/* Row 2: Category/Loan/Supplier/Partner based on tab */}
            {activeTab === 'shop' && (
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
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
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">Partner</option>
                  <option value="taher">Taher</option>
                  <option value="abdulqadir">Abdulqadir</option>
                </select>
                <select
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value as 'shop' | 'own_pocket' })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="shop">From Shop</option>
                  <option value="own_pocket">Own Pocket</option>
                </select>
              </div>
            )}

            {activeTab === 'partners' && (
              <select
                value={form.partnerId}
                onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Partner</option>
                <option value="taher">Taher</option>
                <option value="abdulqadir">Abdulqadir</option>
              </select>
            )}

            {activeTab === 'loans' && (
              <select
                value={form.loanId}
                onChange={(e) => setForm({ ...form, loanId: e.target.value })}
                onKeyDown={(e) => handleFormKeyNav(e)}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Select Loan</option>
                {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_name} ({formatKES(l.remaining_balance)})</option>)}
              </select>
            )}

            {activeTab === 'suppliers' && (
              <div className="flex gap-1">
                <select
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  onKeyDown={(e) => handleFormKeyNav(e)}
                  className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">Supplier</option>
                  {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name} ({formatKES(s.balance)})</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setShowQuickAddSupplier(!showQuickAddSupplier)}
                  className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                  title="Add new supplier"
                >
                  <UserPlus size={16} className="text-slate-500" />
                </button>
              </div>
            )}

            {/* Inline quick-add supplier */}
            {activeTab === 'suppliers' && showQuickAddSupplier && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
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
                  <button type="button" onClick={handleQuickAddSupplier} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">
                    Add
                  </button>
                  <button type="button" onClick={() => setShowQuickAddSupplier(false)} className="text-slate-500 hover:text-slate-700 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'suppliers' && !editingId && form.supplierId && suppliers.find((s) => s.id === form.supplierId)?.linked_partner_id && (
              <SettlementModeFields
                partnerLabel={suppliers.find((s) => s.id === form.supplierId)?.linked_partner_id === 'abdulqadir' ? 'Abdulqadir' : 'Taher'}
                crossLabel="Mohamedi's Customer Balance"
                available={computeSettlementAvailable(
                  allTransactions,
                  shareRules,
                  historicalProfit,
                  suppliers.find((s) => s.id === form.supplierId)!.linked_partner_id!,
                  customersForLink.find((c) => c.linked_partner_id === suppliers.find((s) => s.id === form.supplierId)?.linked_partner_id)?.credit_balance || 0
                )}
                amounts={form.settlement}
                onChange={(next) => setForm({ ...form, settlement: next })}
              />
            )}

            {/* Description */}
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              onKeyDown={(e) => handleFormKeyNav(e)}
              placeholder="Description (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />

            {/* Notes */}
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              onKeyDown={(e) => handleFormKeyNav(e, () => (editingId ? handleUpdate : handleSave)())}
              placeholder="Notes (optional)"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button
                onClick={guardExpense(editingId ? handleUpdate : handleSave)}
                disabled={savingExpense}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium"
              >
                {savingExpense ? 'Saving...' : editingId ? 'Update' : 'Save'}
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
        </div>
      )}

      {/* Bulk Entry - shop/home expenses only; suppliers/loans/partners payments each need a
          picked record that doesn't fit a fast multi-row flow */}
      {showBulk && (activeTab === 'shop' || activeTab === 'home') && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowBulk(false); setBulkTxnIds([]); } }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4 w-full max-w-3xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">{bulkTxnIds.length > 0 ? 'Edit Bulk Entry' : 'Bulk Entry'} - {activeTab === 'shop' ? 'Shop Expenses' : 'Home Expenses'}</h3>
            <button onClick={() => { setShowBulk(false); setBulkTxnIds([]); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            {bulkForms.map((f, i) => (
              <div key={i} className={`border rounded p-2 ${f.smartFlags?.length ? 'border-2 border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">#{i + 1}</span>
                  {bulkForms.length > 1 && (
                    <button
                      onClick={() => setBulkForms(bulkForms.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {f.smartFlags?.length ? (
                  <ul className="text-amber-700 text-xs list-disc list-inside space-y-0.5 mb-2">
                    {f.smartFlags.map((flag, fi) => <li key={fi}>{flag}</li>)}
                  </ul>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                  <input
                    type="date"
                    value={f.date}
                    onChange={(e) => {
                      const newForms = [...bulkForms];
                      newForms[i] = { ...newForms[i], date: e.target.value };
                      // Row 1's date drives every other row's date too - each
                      // row can still be changed individually after that.
                      if (i === 0) {
                        for (let j = 1; j < newForms.length; j++) newForms[j] = { ...newForms[j], date: e.target.value };
                      }
                      setBulkForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <input
                    type="number"
                    value={f.amount}
                    onChange={(e) => {
                      const newForms = [...bulkForms];
                      newForms[i] = { ...newForms[i], amount: e.target.value };
                      setBulkForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                    placeholder="Amount"
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  {activeTab === 'home' && f.source === 'own_pocket' ? (
                    <div className="border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-xs text-slate-500 flex items-center">No mode - own money</div>
                  ) : (
                    <select
                      value={f.mode}
                      onChange={(e) => {
                        const newForms = [...bulkForms];
                        newForms[i] = { ...newForms[i], mode: e.target.value };
                        setBulkForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="cash">Cash</option>
                      <option value="mpesa">Mpesa</option>
                      <option value="paybill">Paybill</option>
                    </select>
                  )}
                </div>

                {activeTab === 'shop' && (
                  <select
                    value={f.category}
                    onChange={(e) => {
                      const newForms = [...bulkForms];
                      newForms[i] = { ...newForms[i], category: e.target.value };
                      setBulkForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">Category</option>
                    {shopSelectableCategories.map((c) => <option key={c.id} value={c.name}>{c.name.replace('_', ' ')}</option>)}
                  </select>
                )}

                {activeTab === 'home' && (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <select
                      value={f.partnerId}
                      onChange={(e) => {
                        const newForms = [...bulkForms];
                        newForms[i] = { ...newForms[i], partnerId: e.target.value };
                        setBulkForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">Partner</option>
                      <option value="taher">Taher</option>
                      <option value="abdulqadir">Abdulqadir</option>
                    </select>
                    <select
                      value={f.source}
                      onChange={(e) => {
                        const newForms = [...bulkForms];
                        newForms[i] = { ...newForms[i], source: e.target.value as 'shop' | 'own_pocket' };
                        setBulkForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="shop">From Shop</option>
                      <option value="own_pocket">Own Pocket</option>
                    </select>
                  </div>
                )}

                <input
                  type="text"
                  value={f.description}
                  onChange={(e) => {
                    const newForms = [...bulkForms];
                    newForms[i] = { ...newForms[i], description: e.target.value };
                    setBulkForms(newForms);
                  }}
                  onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                  placeholder="Description (optional)"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-2"
                />

                {/* Transaction fee (Mpesa/Paybill only lose money to network fees) */}
                {(f.mode === 'mpesa' || f.mode === 'paybill') && (
                  <input
                    type="number"
                    value={f.transactionFee}
                    onChange={(e) => {
                      const newForms = [...bulkForms];
                      newForms[i] = { ...newForms[i], transactionFee: e.target.value };
                      setBulkForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
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
                        const newForms = [...bulkForms];
                        newForms[i] = { ...newForms[i], isPostDated: e.target.checked };
                        setBulkForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label className="text-xs text-slate-600">Post-dated cheque</label>
                    {f.isPostDated && (
                      <input
                        type="date"
                        value={f.clearsOn}
                        onChange={(e) => {
                          const newForms = [...bulkForms];
                          newForms[i] = { ...newForms[i], clearsOn: e.target.value };
                          setBulkForms(newForms);
                        }}
                        onKeyDown={(e) => handleFormKeyNav(e, addBulkRow)}
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
              onClick={addBulkRow}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded text-sm font-medium flex items-center gap-1"
            >
              <Plus size={14} /> Add Row
            </button>
            <button onClick={handleBulkSave} disabled={bulkSaving} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium">
              {bulkSaving ? 'Saving...' : 'Save All'}
            </button>
            <button onClick={() => { setShowBulk(false); setBulkTxnIds([]); }} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
          </div>
        </div>
        </div>
      )}

      {/* Bulk Payments - Suppliers tab only; each row picks its own supplier, for
          logging payments to many different suppliers at once */}
      {showBulkSupplier && activeTab === 'suppliers' && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowBulkSupplier(false); setBulkSupplierTxnIds([]); } }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4 w-full max-w-3xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">{bulkSupplierTxnIds.length > 0 ? 'Edit Bulk Payments' : 'Bulk Payments to Suppliers'}</h3>
            <button onClick={() => { setShowBulkSupplier(false); setBulkSupplierTxnIds([]); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            {bulkSupplierForms.map((f, i) => (
              <div key={i} className={`border rounded p-2 ${f.smartFlags?.length ? 'border-2 border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">#{i + 1}</span>
                  {bulkSupplierForms.length > 1 && (
                    <button
                      onClick={() => setBulkSupplierForms(bulkSupplierForms.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {f.smartFlags?.length ? (
                  <ul className="text-amber-700 text-xs list-disc list-inside space-y-0.5 mb-2">
                    {f.smartFlags.map((flag, fi) => <li key={fi}>{flag}</li>)}
                  </ul>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <div className="flex gap-1">
                    <select
                      value={f.supplierId}
                      onChange={(e) => {
                        const newForms = [...bulkSupplierForms];
                        newForms[i] = { ...newForms[i], supplierId: e.target.value };
                        setBulkSupplierForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
                      className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">Supplier</option>
                      {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name} ({formatKES(s.balance)})</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBulkQuickAddSupplierRow(bulkQuickAddSupplierRow === i ? null : i)}
                      className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                      title="Add new supplier"
                    >
                      <UserPlus size={16} className="text-slate-500" />
                    </button>
                  </div>
                  <input
                    type="number"
                    value={f.amount}
                    onChange={(e) => {
                      const newForms = [...bulkSupplierForms];
                      newForms[i] = { ...newForms[i], amount: e.target.value };
                      setBulkSupplierForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
                    placeholder="Amount"
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                {/* Inline quick-add supplier, this row only */}
                {bulkQuickAddSupplierRow === i && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded p-2 mb-2">
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
                      <button type="button" onClick={() => handleBulkQuickAddSupplier(i)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">
                        Add
                      </button>
                      <button type="button" onClick={() => setBulkQuickAddSupplierRow(null)} className="text-slate-500 hover:text-slate-700 text-xs">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <input
                    type="date"
                    value={f.date}
                    onChange={(e) => {
                      const newForms = [...bulkSupplierForms];
                      newForms[i] = { ...newForms[i], date: e.target.value };
                      // Row 1's date drives every other row's date too - each
                      // row can still be changed individually after that.
                      if (i === 0) {
                        for (let j = 1; j < newForms.length; j++) newForms[j] = { ...newForms[j], date: e.target.value };
                      }
                      setBulkSupplierForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
                    className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <select
                    value={f.mode}
                    onChange={(e) => {
                      const newForms = [...bulkSupplierForms];
                      newForms[i] = { ...newForms[i], mode: e.target.value };
                      setBulkSupplierForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
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
                    const newForms = [...bulkSupplierForms];
                    newForms[i] = { ...newForms[i], notes: e.target.value };
                    setBulkSupplierForms(newForms);
                  }}
                  onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
                  placeholder="Notes (optional)"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-2"
                />

                {f.supplierId && suppliers.find((s) => s.id === f.supplierId)?.linked_partner_id && (
                  <div className="mb-2">
                    <SettlementModeFields
                      partnerLabel={suppliers.find((s) => s.id === f.supplierId)?.linked_partner_id === 'abdulqadir' ? 'Abdulqadir' : 'Taher'}
                      crossLabel="Mohamedi's Customer Balance"
                      available={computeSettlementAvailable(
                        allTransactions,
                        shareRules,
                        historicalProfit,
                        suppliers.find((s) => s.id === f.supplierId)!.linked_partner_id!,
                        customersForLink.find((c) => c.linked_partner_id === suppliers.find((s) => s.id === f.supplierId)?.linked_partner_id)?.credit_balance || 0
                      )}
                      amounts={f.settlement}
                      onChange={(next) => {
                        const newForms = [...bulkSupplierForms];
                        newForms[i] = { ...newForms[i], settlement: next };
                        setBulkSupplierForms(newForms);
                      }}
                    />
                  </div>
                )}

                {/* Transaction fee (Mpesa/Paybill only lose money to network fees) */}
                {(f.mode === 'mpesa' || f.mode === 'paybill') && (
                  <input
                    type="number"
                    value={f.transactionFee}
                    onChange={(e) => {
                      const newForms = [...bulkSupplierForms];
                      newForms[i] = { ...newForms[i], transactionFee: e.target.value };
                      setBulkSupplierForms(newForms);
                    }}
                    onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
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
                        const newForms = [...bulkSupplierForms];
                        newForms[i] = { ...newForms[i], isPostDated: e.target.checked };
                        setBulkSupplierForms(newForms);
                      }}
                      onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label className="text-xs text-slate-600">Post-dated cheque</label>
                    {f.isPostDated && (
                      <input
                        type="date"
                        value={f.clearsOn}
                        onChange={(e) => {
                          const newForms = [...bulkSupplierForms];
                          newForms[i] = { ...newForms[i], clearsOn: e.target.value };
                          setBulkSupplierForms(newForms);
                        }}
                        onKeyDown={(e) => handleFormKeyNav(e, addBulkSupplierRow)}
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
              onClick={addBulkSupplierRow}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded text-sm font-medium flex items-center gap-1"
            >
              <Plus size={14} /> Add Row
            </button>
            <button onClick={handleBulkSupplierSave} disabled={bulkSupplierSaving} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium">
              {bulkSupplierSaving ? 'Saving...' : 'Save All'}
            </button>
            <button onClick={() => { setShowBulkSupplier(false); setBulkSupplierTxnIds([]); }} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
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

      {/* Bulk Delete bar - appears once anything is selected below */}
      {selectedIds.size > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-3">
          <span className="text-sm text-red-700 font-medium">{selectedIds.size} selected</span>
          <button
            onClick={handleBulkVoid}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Trash2 size={14} /> Delete Selected ({selectedIds.size})
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-slate-500 hover:text-slate-700 text-sm">
            Clear selection
          </button>
        </div>
      )}

      {/* Employees summary - adds up every employee's payments in the
          current date range, not just one person's */}
      {activeTab === 'employees' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg p-3 border bg-slate-50 border-slate-200">
            <p className="text-xs text-slate-500">Total Salary Given</p>
            <p className="text-lg font-bold text-slate-700">KES {formatKES(filtered.reduce((s, t) => s + (t.amount || 0), 0))}</p>
          </div>
          <div className="rounded-lg p-3 border bg-slate-50 border-slate-200">
            <p className="text-xs text-slate-500">Total Commission</p>
            <p className="text-lg font-bold text-slate-700">KES {formatKES(filtered.reduce((s, t) => s + (t.commission || 0), 0))}</p>
          </div>
          <div className="rounded-lg p-3 border bg-amber-50 border-amber-100">
            <p className="text-xs text-amber-600">Total Loan Deducted</p>
            <p className="text-lg font-bold text-amber-700">KES {formatKES(filtered.reduce((s, t) => s + (t.employee_loan_deduction || 0), 0))}</p>
          </div>
          <div className="rounded-lg p-3 border bg-blue-50 border-blue-100">
            <p className="text-xs text-blue-600">Total Advance Deducted</p>
            <p className="text-lg font-bold text-blue-700">KES {formatKES(filtered.reduce((s, t) => s + (t.employee_advance_deduction || 0), 0))}</p>
          </div>
        </div>
      )}

      {/* Employees List - self-contained, not sharing the Expense-category
          row template below (that one assumes fields employee_salary rows
          don't have, like a shop category) */}
      {activeTab === 'employees' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400">No salary payments found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Details</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((t) => {
                  const emp = employees.find((e) => e.id === t.employee_id);
                  return (
                    <Fragment key={t.id}>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 text-slate-600">{formatDate(t.date)}</td>
                      <td className="px-3 py-2 text-slate-700">{emp?.name || '-'}</td>
                      <td className="px-3 py-2 text-slate-600 text-xs">
                        {t.commission ? `Commission KES ${formatKES(t.commission)}. ` : ''}
                        {t.employee_loan_deduction ? `Loan deducted KES ${formatKES(t.employee_loan_deduction)}. ` : ''}
                        {t.employee_advance_deduction ? `Advance deducted KES ${formatKES(t.employee_advance_deduction)}. ` : ''}
                        {t.days_worked ? `${t.days_worked} days worked. ` : ''}
                        {t.notes}
                        {t.edited_at && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Edited</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-800">KES {formatKES(t.amount)}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => { setBulkSalaryEditDate(t.date); setShowBulkSalary(true); }} className="p-1 hover:bg-slate-200 rounded">
                            <Edit2 size={14} className="text-slate-500" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm('Void this salary payment?')) return;
                              const result = await voidEmployeeTransaction(t.id);
                              if (!result.ok) { alert(result.error); return; }
                              fetchData();
                              triggerRefresh();
                            }}
                            className="p-1 hover:bg-red-100 rounded"
                          >
                            <Trash2 size={14} className="text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Expenses List */}
      {activeTab !== 'employees' && (
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
              const dayIds = dayExpenses.map((e) => e.id);
              const allDaySelected = dayIds.length > 0 && dayIds.every((id) => selectedIds.has(id));

              return (
                <div key={date}>
                  <div className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={allDaySelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        const next = new Set(selectedIds);
                        if (allDaySelected) dayIds.forEach((id) => next.delete(id));
                        else dayIds.forEach((id) => next.add(id));
                        setSelectedIds(next);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                      title="Select all entries on this date"
                    />
                    <button
                      onClick={() => {
                        const next = new Set(expandedDates);
                        if (next.has(date)) next.delete(date); else next.add(date);
                        setExpandedDates(next);
                      }}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="font-medium text-slate-800">{formatDate(date)}</span>
                      <span className="text-sm text-slate-500 ml-2">{dayExpenses.length} entries</span>
                      <span className="ml-auto text-sm font-medium text-red-600">KES {formatKES(dayTotal)}</span>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="bg-slate-50 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                            <th className="px-4 py-2"></th>
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
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(exp.id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedIds);
                                    if (e.target.checked) next.add(exp.id); else next.delete(exp.id);
                                    setSelectedIds(next);
                                  }}
                                  className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                                />
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-slate-500">{exp.transaction_id}</td>
                              <td className="px-4 py-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  exp.type === 'partner_draw' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {exp.type === 'partner_draw' ? `${exp.partner_id || 'partner'} draw` : (exp.category || 'misc').replace('_', ' ')}
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
                              <td className="px-4 py-2 text-slate-500">
                                {exp.primary_mode}
                                {exp.clears_on && (
                                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                                    exp.clears_on > todayStr() ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                                  }`} title="Post-dated cheque">
                                    {exp.clears_on > todayStr() ? `Clears ${formatDate(exp.clears_on)}` : 'Cleared'}
                                  </span>
                                )}
                              </td>
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
      )}

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title={
          activeTab === 'employees' ? 'Employees Ledger' :
          activeTab === 'suppliers' ? 'Supplier Payments Ledger' :
          activeTab === 'partners' ? 'Partner Draws Ledger' :
          activeTab === 'loans' ? 'Loan Payments Ledger' :
          'Expenses Ledger'
        }
        filterTypes={
          activeTab === 'employees' ? ['employee_salary', 'employee_loan', 'employee_advance'] :
          activeTab === 'suppliers' ? ['supplier_invoice', 'supplier_payment'] :
          activeTab === 'partners' ? ['partner_draw'] :
          activeTab === 'loans' ? ['loan_payment'] :
          ['expense', 'partner_draw']
        }
      />
    </div>
  );
}