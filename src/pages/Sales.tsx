import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  UserPlus,
  BookOpen,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, todayStr, saleProfit, isSaleIncomplete } from '../utils/format';
import { insertTransactionWithId } from '../utils/transactionId';
import { fetchAllRows } from '../utils/fetchAll';
import { adjustCustomerCredit, adjustCustomerAdvance, adjustSupplierBalance, applySettlementSource, undoSettlementForTransaction, voidSale } from '../utils/balances';
import { syncCommissionExpense } from '../utils/commissionExpense';
import { parseSmartEntryText, parsePayments, detectCommission, parseExcelSmartEntryText, detectPercentCommission } from '../utils/smartEntryParser';
import { findBestMatch } from '../utils/fuzzyMatch';
import { findBulkBatch } from '../utils/batchGroup';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { usePersistentState } from '../context/PageStateContext';
import LedgerModal from '../components/LedgerModal';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import SettlementModeFields, {
  emptySettlementAmounts,
  computeSettlementAvailable,
  settlementAmountsTotal,
  findSettlementOverflows,
  SETTLEMENT_MODE_KEYS,
  SettlementAmounts,
} from '../components/SettlementModeFields';
import type { ShareRule } from '../utils/shareDue';
import { sortCustomersByBalance, sortSuppliersByBalance } from '../utils/sortEntities';
import type { Transaction, Customer, Supplier, HistoricalProfit } from '../types';

type SaleMode = 'cash' | 'mpesa' | 'paybill' | 'split' | 'credit' | 'advance' | 'supplier';

interface SaleForm {
  date: string;
  mode: SaleMode;
  sellingPrice: string;
  costPrice: string;
  profit: string;
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
  payCostToSupplier: boolean;
  costSuppliers: CostSupplierRow[];
  // Extra payment lines on top of the main Mode above - e.g. a customer
  // paying part in Advance and the rest in Mpesa, or Mpesa paid in several
  // separate amounts. Empty for a normal single-mode sale (the untouched,
  // original save path is used whenever this is empty).
  extraLines: PaymentLine[];
  // A customer paid more than this sale's Selling Price and wants the rest
  // banked for next time - a one-off "Deposit Advance" bolted onto the Add
  // Sale form, only ever offered when creating a brand new sale (not on
  // Edit, so re-saving the same sale never fires it twice).
  overpayCustomerId: string;
  overpayAmount: string;
  overpayMode: string;
  // Same "Set reminder" idea already on the Suppliers Invoice form - a
  // collection reminder for this customer, created alongside the sale. Only
  // offered when creating (not Edit), so it can't fire more than once.
  setReminder: boolean;
  reminderDate: string;
  reminderTime: string;
  // Only set on rows that came from Smart Entry and still have something
  // worth a second look before saving - never set on a normally-typed row.
  smartFlags?: string[];
}

export type PaymentLineMode = 'cash' | 'mpesa' | 'paybill' | 'advance' | 'credit' | 'supplier';
export interface PaymentLine {
  mode: PaymentLineMode;
  amount: string;
}

// One row of a (possibly multi-supplier) cost-price split - the item's cost
// price doesn't always come from a single supplier, and any part left
// unassigned here is understood as stock the shop already owned.
interface CostSupplierRow {
  supplierId: string;
  amount: string;
  mode: string;
  settlement: SettlementAmounts;
}

interface SmartPreviewRow {
  posId: string | null;
  date: string;
  sellingPrice: number;
  costPrice: number;
  profit: number;
  commission: number;
  mode: SaleMode;
  customerId: string;
  customerMatchName: string;
  splitMpesa: number;
  splitCash: number;
  splitPaybill: number;
  notes: string;
  flags: string[];
  duplicate: boolean;
}

const emptyForm: SaleForm = {
  date: todayStr(),
  mode: 'cash',
  sellingPrice: '',
  costPrice: '',
  profit: '',
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
  payCostToSupplier: false,
  costSuppliers: [],
  extraLines: [],
  overpayCustomerId: '',
  overpayAmount: '',
  overpayMode: 'cash',
  setReminder: false,
  reminderDate: '',
  reminderTime: '09:00',
};

// Works out how a sale's Selling Price is actually being paid once Extra
// Payment Lines are used - one "main" line (the Mode above, or the 3 Split
// boxes) plus whatever's been added on top. Real-money lines (cash/mpesa/
// paybill) can repeat (e.g. Mpesa paid 3 times) and are saved individually
// via transaction_splits, same as Split mode always has been. Only one
// balance-only line (advance/credit/supplier) is allowed per sale, since a
// transaction only has one customer_id/supplier_id to draw it from.
export function resolvePaymentLines(form: SaleForm): { cashLines: { mode: 'cash' | 'mpesa' | 'paybill'; amount: number }[]; nonCash: { mode: 'advance' | 'credit' | 'supplier'; amount: number } | null; error: string | null } {
  const extra = form.extraLines.filter((l) => parseFloat(l.amount || '0') > 0);
  const isCashMode = (m: string): m is 'cash' | 'mpesa' | 'paybill' => m === 'cash' || m === 'mpesa' || m === 'paybill';

  let mainLines: PaymentLine[];
  if (form.mode === 'split') {
    const splitLines: PaymentLine[] = [
      { mode: 'mpesa', amount: form.splitMpesa || '0' },
      { mode: 'cash', amount: form.splitCash || '0' },
      { mode: 'paybill', amount: form.splitPaybill || '0' },
    ];
    mainLines = splitLines.filter((l) => parseFloat(l.amount) > 0);
    // The Selling Price box is auto-derived from these boxes plus any Extra
    // Payment Lines (see splitTotalWithExtra) - if it's out of sync (e.g.
    // switched into Split mode after typing a price some other way), catch
    // it here rather than silently saving a sale that doesn't add up.
    const sp = parseFloat(form.sellingPrice || '0');
    const splitBoxTotal = mainLines.reduce((s, l) => s + parseFloat(l.amount), 0) + extra.reduce((s, l) => s + parseFloat(l.amount || '0'), 0);
    if (Math.abs(sp - splitBoxTotal) > 0.01) {
      return { cashLines: [], nonCash: null, error: `The Mpesa/Cash/Paybill boxes and extra payment lines add up to KES ${splitBoxTotal.toLocaleString()}, but Selling Price shows KES ${sp.toLocaleString()}. Re-enter an amount in one of the boxes to refresh it before saving.` };
    }
  } else {
    const sp = parseFloat(form.sellingPrice || '0');
    const extraTotal = extra.reduce((s, l) => s + parseFloat(l.amount || '0'), 0);
    const mainAmount = sp - extraTotal;
    if (mainAmount < -0.01) {
      return { cashLines: [], nonCash: null, error: `Extra payment lines (KES ${extraTotal.toLocaleString()}) add up to more than the Selling Price (KES ${sp.toLocaleString()}).` };
    }
    mainLines = mainAmount > 0.01 ? [{ mode: form.mode as PaymentLineMode, amount: String(mainAmount) }] : [];
  }

  const allLines = [...mainLines, ...extra];
  const cashLines = allLines.filter((l) => isCashMode(l.mode)).map((l) => ({ mode: l.mode as 'cash' | 'mpesa' | 'paybill', amount: parseFloat(l.amount) }));
  const nonCashLines = allLines.filter((l) => !isCashMode(l.mode));
  if (nonCashLines.length > 1) {
    return { cashLines: [], nonCash: null, error: 'Only one of Advance, Credit, or Supplier can be used per sale - combine them into one line or remove the extra one.' };
  }
  const nonCash = nonCashLines.length === 1 ? { mode: nonCashLines[0].mode as 'advance' | 'credit' | 'supplier', amount: parseFloat(nonCashLines[0].amount) } : null;
  return { cashLines, nonCash, error: null };
}

// The reverse of resolvePaymentLines - reopening a saved sale for editing
// works out its Extra Payment Line (if any) from what's already there: a
// 'split' sale with a customer/supplier attached has a non-cash portion
// equal to whatever its real cash splits don't cover.
function reconstructExtraLines(sale: Transaction, existingSplits: { mode: string; amount: number }[]): PaymentLine[] {
  if (sale.primary_mode !== 'split' || (!sale.customer_id && !sale.supplier_id)) return [];
  const realSum = existingSplits
    .filter((s) => s.mode === 'cash' || s.mode === 'mpesa' || s.mode === 'paybill')
    .reduce((s, x) => s + x.amount, 0);
  const nonCash = (sale.amount || 0) - realSum;
  if (nonCash <= 0.01) return [];
  if (sale.customer_id && sale.settlement_mode) return [{ mode: 'advance', amount: String(nonCash) }];
  if (sale.customer_id) return [{ mode: 'credit', amount: String(nonCash) }];
  if (sale.supplier_id) return [{ mode: 'supplier', amount: String(nonCash) }];
  return [];
}

export default function Sales() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [sales, setSales] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [shareRules, setShareRules] = useState<ShareRule[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = usePersistentState('sales.showAdd', false);
  const [showBulk, setShowBulk] = usePersistentState('sales.showBulk', false);
  const [editingId, setEditingId] = usePersistentState<string | null>('sales.editingId', null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = usePersistentState<SaleForm>('sales.form', emptyForm);
  const [bulkForms, setBulkForms] = usePersistentState<SaleForm[]>('sales.bulkForms', () => Array.from({ length: 10 }, () => ({ ...emptyForm })));
  // Parallel to bulkForms - set when this bulk form was reopened to edit a
  // past batch (see startEdit), so Save All knows which rows to update in
  // place instead of inserting as new sales. Empty for a fresh bulk entry.
  const [bulkTxnIds, setBulkTxnIds] = usePersistentState<(string | null)[]>('sales.bulkTxnIds', () => []);
  const [search, setSearch] = usePersistentState('sales.search', '');
  const [filterMode, setFilterMode] = usePersistentState<string>('sales.filterMode', '');
  const [datePreset, setDatePreset] = usePersistentState<DatePreset>('sales.datePreset', 'month');
  const [customFrom, setCustomFrom] = usePersistentState('sales.customFrom', '');
  const [customTo, setCustomTo] = usePersistentState('sales.customTo', '');
  const [expandedDates, setExpandedDates] = usePersistentState<Set<string>>('sales.expandedDates', () => new Set());
  const [highlightedSaleId, setHighlightedSaleId] = usePersistentState<string | null>('sales.highlightedSaleId', null);
  const [showLedger, setShowLedger] = useState(false);
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false);
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({ name: '', phone: '', creditLimit: '' });
  const [quickSupplier, setQuickSupplier] = useState({ name: '', phone: '', balance: '' });
  // Index into form.costSuppliers of the row whose quick-add mini-form is
  // open (null = none) - there can be several cost-supplier rows now, so a
  // single boolean isn't enough to say which one's panel is showing.
  const [costSupplierQuickAddIndex, setCostSupplierQuickAddIndex] = useState<number | null>(null);
  const [quickCostSupplier, setQuickCostSupplier] = useState({ name: '', phone: '' });
  // Which Bulk Entry row has its quick-add mini-form open (null = none) - only
  // one at a time, but it always shows inline in the row that opened it,
  // not in one shared spot you'd have to go looking for.
  const [bulkQuickAddCustomerRow, setBulkQuickAddCustomerRow] = useState<number | null>(null);
  const [bulkQuickAddSupplierRow, setBulkQuickAddSupplierRow] = useState<number | null>(null);
  // Same idea as costSupplierQuickAddIndex, but also needs which bulk row.
  const [bulkQuickAddCostSupplierRow, setBulkQuickAddCostSupplierRow] = useState<{ row: number; idx: number } | null>(null);
  const [refundingSale, setRefundingSale] = usePersistentState<Transaction | null>('sales.refundingSale', null);
  const [refundForm, setRefundForm] = usePersistentState('sales.refundForm', { amount: '', costPrice: '', profit: '', mode: 'cash', date: todayStr() });
  const [showDepositAdvance, setShowDepositAdvance] = usePersistentState('sales.showDepositAdvance', false);
  const [advanceDepositForm, setAdvanceDepositForm] = usePersistentState('sales.advanceDepositForm', { customerId: '', amount: '', date: todayStr(), mode: 'cash', notes: '' });
  const [showSmartEntry, setShowSmartEntry] = usePersistentState('sales.showSmartEntry', false);
  const [smartEntryPaste, setSmartEntryPaste] = usePersistentState('sales.smartEntryPaste', '');
  const [smartEntryPreview, setSmartEntryPreview] = usePersistentState<SmartPreviewRow[]>('sales.smartEntryPreview', () => []);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    const match = sales.find((s) => s.id === editId);
    if (match) {
      setDatePreset('all');
      setExpandedDates((prev) => new Set(prev).add(match.date));
      startEdit(match);
      setSearchParams({}, { replace: true });
    }
  }, [sales, searchParams]);

  // "Add Sale" clicked from a customer's own page - opens a fresh Add Sale
  // form with that customer already picked, so their sale can be entered
  // without hunting them down again here.
  useEffect(() => {
    const customerId = searchParams.get('newForCustomer');
    if (!customerId) return;
    setEditingId(null);
    setBulkTxnIds([]);
    setForm({ ...emptyForm, date: todayStr(), mode: 'credit', customerId });
    setShowAdd(true);
    setShowBulk(false);
    setSearchParams({}, { replace: true });
  }, [searchParams]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: splitData }, { data: cust }, { data: supp }, { data: fullTxns }, { data: rules }, { data: hist }] = await Promise.all([
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('type', 'sale').order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, to)
      ),
      supabase.from('transaction_splits').select('*'),
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      // Needed for the linked-partner settlement calc (Home Expenses Owed /
      // Profit Share Not Taken) - those scan ALL transaction types, not just sales.
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }).range(from, to)
      ),
      supabase.from('share_rules').select('*').eq('is_active', true),
      supabase.from('historical_profit').select('*'),
    ]);
    setSales(txns || []);
    setSplits(splitData || []);
    setCustomers(cust || []);
    setSuppliers(supp || []);
    setAllTransactions(fullTxns || []);
    setShareRules(rules || []);
    setHistoricalProfit(hist || []);
    setLoading(false);
  }

  async function handleQuickAddCustomer() {
    const name = quickCustomer.name.trim();
    if (!name) { alert('Enter a name before saving.'); return; }
    if (customers.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      alert('A customer with this name already exists.');
      return;
    }
    const { data } = await supabase.from('customers').insert({
      name,
      phone: quickCustomer.phone || null,
      credit_limit: parseFloat(quickCustomer.creditLimit || '0'),
    }).select().single();
    if (data) {
      setCustomers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, customerId: data.id }));
      setShowQuickAddCustomer(false);
      setQuickCustomer({ name: '', phone: '', creditLimit: '' });
    }
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
      // Mirror a nonzero opening balance into transactions so it shows up in
      // Reports/the Ledger with a visible origin, and can be edited/deleted later
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

  // Same as the quick-adds above, but for one specific Bulk Entry row instead
  // of the single Add/Edit form - the new customer/supplier still becomes
  // available to every other row's dropdown right away too.
  async function handleBulkQuickAddCustomer(rowIndex: number) {
    const name = quickCustomer.name.trim();
    if (!name) { alert('Enter a name before saving.'); return; }
    if (customers.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      alert('A customer with this name already exists.');
      return;
    }
    const { data } = await supabase.from('customers').insert({
      name,
      phone: quickCustomer.phone || null,
      credit_limit: parseFloat(quickCustomer.creditLimit || '0'),
    }).select().single();
    if (data) {
      setCustomers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setBulkForms((prev) => {
        const next = [...prev];
        next[rowIndex] = { ...next[rowIndex], customerId: data.id };
        return next;
      });
      setBulkQuickAddCustomerRow(null);
      setQuickCustomer({ name: '', phone: '', creditLimit: '' });
    }
  }

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
      setBulkForms((prev) => {
        const next = [...prev];
        next[rowIndex] = { ...next[rowIndex], supplierId: data.id };
        return next;
      });
      setBulkQuickAddSupplierRow(null);
      setQuickSupplier({ name: '', phone: '', balance: '' });
    }
  }

  async function handleBulkQuickAddCostSupplier(rowIndex: number, subIndex: number) {
    const name = quickCostSupplier.name.trim();
    if (!name) { alert('Enter a name before saving.'); return; }
    if (suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      alert('A supplier with this name already exists.');
      return;
    }
    const { data } = await supabase.from('suppliers').insert({
      name,
      phone: quickCostSupplier.phone || null,
      balance: 0,
    }).select().single();
    if (data) {
      setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setBulkForms((prev) => {
        const next = [...prev];
        const costSuppliers = [...next[rowIndex].costSuppliers];
        costSuppliers[subIndex] = { ...costSuppliers[subIndex], supplierId: data.id };
        next[rowIndex] = { ...next[rowIndex], costSuppliers };
        return next;
      });
      setBulkQuickAddCostSupplierRow(null);
      setQuickCostSupplier({ name: '', phone: '' });
    }
  }

  async function handleDepositAdvance() {
    if (!advanceDepositForm.customerId) {
      alert('Pick a Customer before saving.');
      return;
    }
    if (!advanceDepositForm.amount || parseFloat(advanceDepositForm.amount) <= 0) {
      alert('Enter an Amount before saving.');
      return;
    }

    const amt = parseFloat(advanceDepositForm.amount);
    const customer = customers.find((c) => c.id === advanceDepositForm.customerId);
    if (!customer) return;

    const { data: newTxn, error } = await insertTransactionWithId('ADV-' + advanceDepositForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: advanceDepositForm.date,
      type: 'customer_payment',
      primary_mode: advanceDepositForm.mode,
      amount: amt,
      customer_id: advanceDepositForm.customerId,
      description: `Advance from ${customer.name}`,
      notes: advanceDepositForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save advance: ' + (error?.message || 'unknown error')); return; }

    await adjustCustomerAdvance(advanceDepositForm.customerId, amt);

    setAdvanceDepositForm({ customerId: '', amount: '', date: todayStr(), mode: 'cash', notes: '' });
    setShowDepositAdvance(false);
    fetchData();
    triggerRefresh();
  }

  async function handleQuickAddCostSupplier(subIndex: number) {
    const name = quickCostSupplier.name.trim();
    if (!name) { alert('Enter a name before saving.'); return; }
    if (suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      alert('A supplier with this name already exists.');
      return;
    }
    const { data } = await supabase.from('suppliers').insert({
      name,
      phone: quickCostSupplier.phone || null,
      balance: 0,
    }).select().single();
    if (data) {
      setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => {
        const costSuppliers = [...f.costSuppliers];
        costSuppliers[subIndex] = { ...costSuppliers[subIndex], supplierId: data.id };
        return { ...f, costSuppliers };
      });
      setCostSupplierQuickAddIndex(null);
      setQuickCostSupplier({ name: '', phone: '' });
    }
  }

  async function handleSave() {
    if (saving) return;
    if (!form.sellingPrice || parseFloat(form.sellingPrice) <= 0) {
      alert('Enter a Selling Price before saving.');
      return;
    }
    if ((form.mode === 'credit' || form.mode === 'advance' || form.extraLines.some((l) => l.mode === 'credit' || l.mode === 'advance')) && !form.customerId) {
      const keepEditing = confirm('No Customer picked. Click OK to go back and pick one, or Cancel to close this form without saving.');
      if (!keepEditing) { setForm(emptyForm); setShowAdd(false); }
      return;
    }
    if ((form.mode === 'supplier' || form.extraLines.some((l) => l.mode === 'supplier')) && !form.supplierId) {
      const keepEditing = confirm('No Supplier picked. Click OK to go back and pick one, or Cancel to close this form without saving.');
      if (!keepEditing) { setForm(emptyForm); setShowAdd(false); }
      return;
    }
    if (form.mode === 'split') {
      const splitTotal = parseFloat(form.splitMpesa || '0') + parseFloat(form.splitCash || '0') + parseFloat(form.splitPaybill || '0');
      if (splitTotal <= 0 && form.extraLines.length === 0) {
        alert('Enter how much was paid via Mpesa, Cash, and/or Paybill for this split sale - it cannot be saved with nothing entered, or the money would silently disappear from your balance.');
        return;
      }
    }
    if (form.extraLines.some((l) => parseFloat(l.amount || '0') <= 0)) {
      alert('Every extra payment line needs an amount before saving - remove any empty ones.');
      return;
    }
    if (form.overpayAmount && parseFloat(form.overpayAmount) > 0 && !(form.overpayCustomerId || form.customerId)) {
      alert('Pick which customer the extra payment goes to before saving.');
      return;
    }
    if (form.setReminder && !form.reminderDate) {
      alert('Pick a reminder date before saving, or turn off "Set a reminder".');
      return;
    }

    // Cancel goes back to the form so the user can fill in the Cost Price;
    // OK saves anyway and profit will show as 0 until edited later.
    if (!form.costPrice || form.costPrice.trim() === '') {
      const saveAnyway = confirm('Cost Price not entered. Click OK to save anyway (profit will show as 0 until you edit it later), or Cancel to go back and enter the Cost Price.');
      if (!saveAnyway) return;
    }

    // The supplier split can't add up to more than the cost price itself -
    // whatever's left over is understood as stock the shop already owned,
    // not a negative amount owed to a supplier.
    if (form.payCostToSupplier) {
      const cpTotal = parseFloat(form.costPrice || '0');
      const assigned = form.costSuppliers.reduce((s, c) => s + (parseFloat(c.amount || '0') || 0), 0);
      if (assigned > cpTotal + 0.01) {
        alert(`Supplier amounts (KES ${assigned.toLocaleString()}) add up to more than the Cost Price (KES ${cpTotal.toLocaleString()}). Please fix this before saving.`);
        return;
      }
    }

    setSaving(true);
    try {

    const sp = parseFloat(form.sellingPrice);
    const cp = parseFloat(form.costPrice || '0');
    const comm = parseFloat(form.commission || '0');

    // Extra Payment Lines (e.g. part Advance + part Mpesa) reuse the same
    // 'split' storage Split mode always has, plus whichever single Advance/
    // Credit/Supplier balance the non-cash line draws from - everything
    // below this stays the exact original single-mode/Split save path.
    const usesExtraLines = form.extraLines.length > 0;
    let lines: ReturnType<typeof resolvePaymentLines> | null = null;
    if (usesExtraLines) {
      lines = resolvePaymentLines(form);
      if (lines.error) { alert(lines.error); setSaving(false); return; }
    }

    const primaryMode = usesExtraLines ? 'split' : form.mode;
    const settlementMode = usesExtraLines
      ? (lines!.nonCash?.mode === 'advance' ? form.advanceMode : null)
      : (form.mode === 'advance' ? form.advanceMode : null);
    const customerIdForRow = usesExtraLines
      ? (lines!.nonCash?.mode === 'advance' || lines!.nonCash?.mode === 'credit' ? (form.customerId || null) : null)
      : (form.mode === 'credit' || form.mode === 'advance' ? (form.customerId || null) : null);
    const supplierIdForRow = usesExtraLines
      ? (lines!.nonCash?.mode === 'supplier' ? (form.supplierId || null) : null)
      : (form.mode === 'supplier' ? (form.supplierId || null) : null);

    const prefix = 'SAL-' + form.date.replace(/-/g, '');
    const { data: newTxn, error, transactionId: txnId } = await insertTransactionWithId(prefix, (transactionId) => {
      const row: any = {
        transaction_id: transactionId,
        date: form.date,
        type: 'sale',
        primary_mode: primaryMode,
        settlement_mode: settlementMode,
        amount: sp,
        description: form.notes || null,
        notes: !usesExtraLines && form.mode === 'advance' ? `Advance payment via ${form.advanceMode}${form.notes ? ' | ' + form.notes : ''}` : (form.notes || null),
        selling_price: sp,
        cost_price: cp || null,
        commission: comm || null,
        commission_mode: comm > 0 ? form.commissionMode : null,
        is_unclassified: form.isUnclassified,
        customer_id: customerIdForRow,
        supplier_id: supplierIdForRow,
        created_by: user?.username || null,
      };
      return row;
    });
    if (error || !newTxn) { console.error(error); alert('Failed to save sale: ' + (error?.message || 'unknown error')); return; }

    if (usesExtraLines) {
      const splitRows = lines!.cashLines.map((l) => ({ transaction_id: txnId, mode: l.mode, amount: l.amount }));
      if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);

      if (lines!.nonCash?.mode === 'advance' && form.customerId) {
        await adjustCustomerAdvance(form.customerId, -lines!.nonCash.amount);
      } else if (lines!.nonCash?.mode === 'credit' && form.customerId) {
        await adjustCustomerCredit(form.customerId, lines!.nonCash.amount);
      } else if (lines!.nonCash?.mode === 'supplier' && form.supplierId) {
        await adjustSupplierBalance(form.supplierId, -lines!.nonCash.amount);
      }
    } else {
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
    }

    // Optionally, pay one or more suppliers back for the cost of this item
    // right away (e.g. bought on the spot from another shop, sold
    // immediately) - the cost can be split across several suppliers, with
    // whatever's left unassigned understood as stock the shop already owned.
    // Each supplier gets its own invoice (cost taken) plus payment (cost
    // given back) so both show up as their own lines on that supplier's ledger.
    if (form.payCostToSupplier) {
      for (const cs of form.costSuppliers) {
        const costAmt = parseFloat(cs.amount || '0');
        if (!cs.supplierId || costAmt <= 0) continue;

        const csSupplier = suppliers.find((s) => s.id === cs.supplierId);
        if (csSupplier?.linked_partner_id) {
          const settlementTotal = settlementAmountsTotal(cs.settlement);
          if (settlementTotal > 0) {
            const csLinkedCustomer = customers.find((c) => c.linked_partner_id === csSupplier.linked_partner_id);
            const available = computeSettlementAvailable(allTransactions, shareRules, historicalProfit, csSupplier.linked_partner_id, csLinkedCustomer?.credit_balance || 0);
            const warnings = findSettlementOverflows(cs.settlement, available, "Mohamedi's Customer Balance");
            if (warnings.length > 0 && !confirm(warnings.join('\n\n') + '\n\nContinue?')) continue;
          }
        }

        const invPrefix = 'INV-' + form.date.replace(/-/g, '');
        const { data: invTxn, error: invError } = await insertTransactionWithId(invPrefix, (transactionId) => ({
          transaction_id: transactionId,
          date: form.date,
          type: 'supplier_invoice',
          primary_mode: null,
          amount: costAmt,
          supplier_id: cs.supplierId,
          description: 'Cost price taken on sale ' + txnId,
          created_by: user?.username || null,
        }));
        if (invError || !invTxn) {
          console.error(invError);
          alert('Sale saved, but recording a supplier cost failed: ' + (invError?.message || 'unknown error'));
          continue;
        }
        await adjustSupplierBalance(cs.supplierId, costAmt);

        const supplier = suppliers.find((s) => s.id === cs.supplierId);
        const linkedPartnerId = supplier?.linked_partner_id;
        const linkedCustomer = linkedPartnerId ? customers.find((c) => c.linked_partner_id === linkedPartnerId) : undefined;
        const settlementTotal = linkedPartnerId ? settlementAmountsTotal(cs.settlement) : 0;
        const cashAmt = costAmt - settlementTotal;

        const payPrefix = 'SUP-' + form.date.replace(/-/g, '');
        const { data: payTxn, error: payError } = await insertTransactionWithId(payPrefix, (transactionId) => ({
          transaction_id: transactionId,
          date: form.date,
          type: 'supplier_payment',
          primary_mode: cashAmt > 0 ? cs.mode : null,
          amount: costAmt,
          supplier_id: cs.supplierId,
          description: 'Cost price paid on sale ' + txnId,
          created_by: user?.username || null,
        }));
        if (payError || !payTxn) {
          console.error(payError);
          alert('Sale saved, and a supplier cost was recorded, but paying it back failed: ' + (payError?.message || 'unknown error'));
        } else {
          await adjustSupplierBalance(cs.supplierId, -costAmt);

          const splitRows: { transaction_id: string; mode: string; amount: number }[] = [];
          if (cashAmt > 0) splitRows.push({ transaction_id: payTxn.transaction_id, mode: cs.mode, amount: cashAmt });
          if (linkedPartnerId && settlementTotal > 0 && supplier) {
            const ctx = {
              partnerId: linkedPartnerId,
              date: form.date,
              createdBy: user?.username || null,
              refLabel: supplier.name,
              primaryTransactionId: payTxn.transaction_id,
              crossPartyId: linkedCustomer?.id || null,
              crossPartyRole: 'customer' as const,
            };
            for (const { key, mode } of SETTLEMENT_MODE_KEYS) {
              const srcAmount = parseFloat(cs.settlement[key] || '0') || 0;
              if (srcAmount > 0) {
                splitRows.push({ transaction_id: payTxn.transaction_id, mode, amount: srcAmount });
                await applySettlementSource(mode, srcAmount, ctx);
              }
            }
          }
          if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);
        }
      }
    }

    if (comm > 0) {
      await syncCommissionExpense(txnId, form.date, comm, form.commissionMode, user?.username || null);
    }

    // Customer paid more than the Selling Price - bank the rest as advance,
    // same as the standalone Deposit Advance action (a separate transaction,
    // not part of this sale).
    const overpayAmt = parseFloat(form.overpayAmount || '0');
    const overpayCustomerId = form.overpayCustomerId || form.customerId;
    if (overpayAmt > 0 && overpayCustomerId) {
      const overpayCustomer = customers.find((c) => c.id === overpayCustomerId);
      const { data: depTxn, error: depError } = await insertTransactionWithId('ADV-' + form.date.replace(/-/g, ''), (transactionId) => ({
        transaction_id: transactionId,
        date: form.date,
        type: 'customer_payment',
        primary_mode: form.overpayMode,
        amount: overpayAmt,
        customer_id: overpayCustomerId,
        description: `Advance from ${overpayCustomer?.name || 'customer'}`,
        notes: `Extra paid on sale ${txnId}`,
        created_by: user?.username || null,
      }));
      if (depError || !depTxn) {
        console.error(depError);
        alert('Sale saved, but recording the extra amount into advance failed: ' + (depError?.message || 'unknown error'));
      } else {
        await adjustCustomerAdvance(overpayCustomerId, overpayAmt);
      }
    }

    // Set Reminder - same pattern already used on the Suppliers Invoice
    // form, just for a customer's Credit/Advance sale instead.
    if (form.setReminder && form.reminderDate && form.customerId) {
      await supabase.from('reminders').insert({
        reminder_type: 'customer_collection',
        entity_id: form.customerId,
        entity_type: 'customer',
        amount: sp,
        due_date: form.date,
        reminder_date: form.reminderDate,
        reminder_time: form.reminderTime || null,
        notes: `Sale ${txnId}`,
      });
    }

    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkSave() {
    if (saving) return;
    const overAllocatedRows: number[] = [];
    const noPriceRows: number[] = [];
    const noCustomerRows: number[] = [];
    const noSupplierRows: number[] = [];
    const noSplitAmountRows: number[] = [];
    const badExtraLineRows: number[] = [];
    const validForms = bulkForms
      .map((f, originalIndex) => ({ f, originalIndex }))
      .filter(({ f, originalIndex }) => {
        const rowTouched = !!(f.customerId || f.supplierId || f.notes || f.costPrice || f.commission);
        if (!f.sellingPrice || parseFloat(f.sellingPrice) <= 0) { if (rowTouched) noPriceRows.push(originalIndex + 1); return false; }
        if ((f.mode === 'credit' || f.mode === 'advance' || f.extraLines.some((l) => l.mode === 'credit' || l.mode === 'advance')) && !f.customerId) { noCustomerRows.push(originalIndex + 1); return false; }
        if ((f.mode === 'supplier' || f.extraLines.some((l) => l.mode === 'supplier')) && !f.supplierId) { noSupplierRows.push(originalIndex + 1); return false; }
        if (f.mode === 'split') {
          const splitTotal = parseFloat(f.splitMpesa || '0') + parseFloat(f.splitCash || '0') + parseFloat(f.splitPaybill || '0');
          if (splitTotal <= 0 && f.extraLines.length === 0) { noSplitAmountRows.push(originalIndex + 1); return false; }
        }
        if (f.extraLines.some((l) => parseFloat(l.amount || '0') <= 0)) { badExtraLineRows.push(originalIndex + 1); return false; }
        // Same rule as the single Add Sale form: the supplier split can't add
        // up to more than the cost price - the rest is stock the shop
        // already owned, not a negative amount owed to a supplier.
        if (f.payCostToSupplier) {
          const cpTotal = parseFloat(f.costPrice || '0');
          const assigned = f.costSuppliers.reduce((s, c) => s + (parseFloat(c.amount || '0') || 0), 0);
          if (assigned > cpTotal + 0.01) {
            overAllocatedRows.push(originalIndex + 1);
            return false;
          }
        }
        return true;
      });
    if (overAllocatedRows.length > 0) {
      alert(`Row(s) ${overAllocatedRows.join(', ')}: supplier amounts add up to more than the Cost Price. Fix these rows before they can be saved - the rest will still save.`);
    }
    if (noCustomerRows.length > 0) {
      alert(`Row(s) ${noCustomerRows.join(', ')}: no Customer picked for a Credit/Advance sale - these rows were NOT saved. Pick a customer and save them again.`);
    }
    if (noSupplierRows.length > 0) {
      alert(`Row(s) ${noSupplierRows.join(', ')}: no Supplier picked for a Supplier sale - these rows were NOT saved. Pick a supplier and save them again.`);
    }
    if (noSplitAmountRows.length > 0) {
      alert(`Row(s) ${noSplitAmountRows.join(', ')}: split sale has nothing entered for Mpesa, Cash, or Paybill - these rows were NOT saved.`);
    }
    if (badExtraLineRows.length > 0) {
      alert(`Row(s) ${badExtraLineRows.join(', ')}: an extra payment line has no amount - these rows were NOT saved. Remove any empty extra lines and save again.`);
    }
    if (noPriceRows.length > 0) {
      alert(`Row(s) ${noPriceRows.join(', ')}: no Selling Price entered - these rows were NOT saved.`);
    }
    if (validForms.length === 0) return;
    setSaving(true);
    try {

    // Not a hard block - just a heads-up. These rows still save either way;
    // profit will show as 0 until the cost price is filled in via Edit.
    const missingCostRows = validForms.filter(({ f }) => !f.costPrice || f.costPrice.trim() === '').map(({ originalIndex }) => originalIndex + 1);
    if (missingCostRows.length > 0) {
      alert(`Cost Price not entered for row(s) ${missingCostRows.join(', ')}. They will still be saved - profit will show as 0 until you edit them later and fill in the real cost.`);
    }

    const failedRows: number[] = [];

    for (let i = 0; i < validForms.length; i++) {
      const { f, originalIndex } = validForms[i];
      const existingTxnId = bulkTxnIds[originalIndex];

      // A row reopened from a past batch (see startEdit) is saved back
      // through the same update path the single Edit form uses - the
      // pay-cost-to-supplier flow below is create-time-only convenience and
      // isn't reconstructed here.
      if (existingTxnId) {
        const oldTxn = sales.find((s) => s.id === existingTxnId);
        if (!oldTxn) { failedRows.push(originalIndex + 1); continue; }
        const result = await applySaleUpdate(oldTxn, f);
        if (!result.ok) { console.error(result.error); failedRows.push(originalIndex + 1); }
        continue;
      }

      const sp = parseFloat(f.sellingPrice);
      const cp = parseFloat(f.costPrice || '0');
      const comm = parseFloat(f.commission || '0');
      const prefix = 'SAL-' + f.date.replace(/-/g, '');

      // Same Extra Payment Lines handling as the single Add Sale form - see
      // handleSave.
      const usesExtraLines = f.extraLines.length > 0;
      let lines: ReturnType<typeof resolvePaymentLines> | null = null;
      if (usesExtraLines) {
        lines = resolvePaymentLines(f);
        if (lines.error) { console.error(lines.error); failedRows.push(originalIndex + 1); continue; }
      }
      const primaryMode = usesExtraLines ? 'split' : f.mode;
      const settlementMode = usesExtraLines
        ? (lines!.nonCash?.mode === 'advance' ? f.advanceMode : null)
        : (f.mode === 'advance' ? f.advanceMode : null);
      const customerIdForRow = usesExtraLines
        ? (lines!.nonCash?.mode === 'advance' || lines!.nonCash?.mode === 'credit' ? (f.customerId || null) : null)
        : (f.mode === 'credit' || f.mode === 'advance' ? (f.customerId || null) : null);
      const supplierIdForRow = usesExtraLines
        ? (lines!.nonCash?.mode === 'supplier' ? (f.supplierId || null) : null)
        : (f.mode === 'supplier' ? (f.supplierId || null) : null);

      const { data: newTxn, error, transactionId: txnId } = await insertTransactionWithId(prefix, (transactionId) => ({
        transaction_id: transactionId,
        date: f.date,
        type: 'sale',
        primary_mode: primaryMode,
        settlement_mode: settlementMode,
        amount: sp,
        description: f.notes || null,
        notes: !usesExtraLines && f.mode === 'advance' ? `Advance payment via ${f.advanceMode}${f.notes ? ' | ' + f.notes : ''}` : (f.notes || null),
        selling_price: sp,
        cost_price: cp || null,
        commission: comm || null,
        commission_mode: comm > 0 ? f.commissionMode : null,
        is_unclassified: f.isUnclassified,
        customer_id: customerIdForRow,
        supplier_id: supplierIdForRow,
        created_by: user?.username || null,
      }));
      if (error || !newTxn) { console.error(error); failedRows.push(originalIndex + 1); continue; }

      if (usesExtraLines) {
        const splitRows = lines!.cashLines.map((l) => ({ transaction_id: txnId, mode: l.mode, amount: l.amount }));
        if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);

        if (lines!.nonCash?.mode === 'advance' && f.customerId) {
          await adjustCustomerAdvance(f.customerId, -lines!.nonCash.amount);
        } else if (lines!.nonCash?.mode === 'credit' && f.customerId) {
          await adjustCustomerCredit(f.customerId, lines!.nonCash.amount);
        } else if (lines!.nonCash?.mode === 'supplier' && f.supplierId) {
          await adjustSupplierBalance(f.supplierId, -lines!.nonCash.amount);
        }
      } else {
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

      if (comm > 0) {
        await syncCommissionExpense(txnId, f.date, comm, f.commissionMode, user?.username || null);
      }

      if (f.payCostToSupplier) {
        for (const cs of f.costSuppliers) {
          const costAmt = parseFloat(cs.amount || '0');
          if (!cs.supplierId || costAmt <= 0) continue;

          const invPrefix = 'INV-' + f.date.replace(/-/g, '');
          const { data: invTxn, error: invError } = await insertTransactionWithId(invPrefix, (transactionId) => ({
            transaction_id: transactionId,
            date: f.date,
            type: 'supplier_invoice',
            primary_mode: null,
            amount: costAmt,
            supplier_id: cs.supplierId,
            description: 'Cost price taken on sale ' + txnId,
            created_by: user?.username || null,
          }));
          if (invError || !invTxn) { console.error(invError); continue; }
          await adjustSupplierBalance(cs.supplierId, costAmt);

          const supplier = suppliers.find((s) => s.id === cs.supplierId);
          const linkedPartnerId = supplier?.linked_partner_id;
          const linkedCustomer = linkedPartnerId ? customers.find((c) => c.linked_partner_id === linkedPartnerId) : undefined;
          const settlementTotal = linkedPartnerId ? settlementAmountsTotal(cs.settlement) : 0;
          const cashAmt = costAmt - settlementTotal;

          const payPrefix = 'SUP-' + f.date.replace(/-/g, '');
          const { data: payTxn, error: payError } = await insertTransactionWithId(payPrefix, (transactionId) => ({
            transaction_id: transactionId,
            date: f.date,
            type: 'supplier_payment',
            primary_mode: cashAmt > 0 ? cs.mode : null,
            amount: costAmt,
            supplier_id: cs.supplierId,
            description: 'Cost price paid on sale ' + txnId,
            created_by: user?.username || null,
          }));
          if (!payError && payTxn) {
            await adjustSupplierBalance(cs.supplierId, -costAmt);

            const splitRows: { transaction_id: string; mode: string; amount: number }[] = [];
            if (cashAmt > 0) splitRows.push({ transaction_id: payTxn.transaction_id, mode: cs.mode, amount: cashAmt });
            if (linkedPartnerId && settlementTotal > 0 && supplier) {
              const ctx = {
                partnerId: linkedPartnerId,
                date: f.date,
                createdBy: user?.username || null,
                refLabel: supplier.name,
                primaryTransactionId: payTxn.transaction_id,
                crossPartyId: linkedCustomer?.id || null,
                crossPartyRole: 'customer' as const,
              };
              for (const { key, mode } of SETTLEMENT_MODE_KEYS) {
                const srcAmount = parseFloat(cs.settlement[key] || '0') || 0;
                if (srcAmount > 0) {
                  splitRows.push({ transaction_id: payTxn.transaction_id, mode, amount: srcAmount });
                  await applySettlementSource(mode, srcAmount, ctx);
                }
              }
            }
            if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);
          }
        }
      }
    }

    setBulkForms(Array.from({ length: 10 }, () => ({ ...emptyForm })));
    setBulkTxnIds([]);
    setShowBulk(false);
    fetchData();
    triggerRefresh();
    if (failedRows.length > 0) {
      alert(`Row(s) ${failedRows.join(', ')} failed to save and were skipped. The rest were saved successfully.`);
    }
    } finally {
      setSaving(false);
    }
  }

  // Turns a paste from an external sales export into preview rows. Understands
  // two formats in the same paste, parsed independently then merged:
  // 1) the POS export (Sale Id/Date-time/Sold To/...) - reverses any
  //    "LESS ### CMSN" commission netted out of the source's own Total, works
  //    out Cash/Mpesa/Paybill/Credit/Split from the Payment Type text,
  //    fuzzy-matches a "Sold To" name against existing customers, and checks
  //    the source's own Sale ID against already-saved sales so a re-paste of
  //    the same rows gets skipped instead of silently duplicated.
  // 2) a spreadsheet-style table (Date "DD/MM - Day"/Mode/Selling
  //    Price/Cost Price/Commission/Profit/Comments) - assumes the current
  //    year (the date has none), and is always flagged for a closer look
  //    since it's newer and less battle-tested than the POS format.
  function handleSmartEntryParse() {
    const parsed = parseSmartEntryText(smartEntryPaste);
    const posPreview: SmartPreviewRow[] = parsed.map((r) => {
      const flags: string[] = [];
      let sellingPrice = r.total;
      let commission = 0;
      const cm = detectCommission(r.comments);
      if (cm) {
        if (cm.confident) {
          commission = cm.amount;
          sellingPrice = r.total + cm.amount;
        } else {
          flags.push(`Comment mentions "LESS ${cm.amount.toLocaleString()}" without confirming it's commission - check if Selling Price/Commission should change.`);
        }
      }

      const payments = parsePayments(r.paymentTypeStr);
      let mode: SaleMode = 'cash';
      let splitMpesa = 0, splitCash = 0, splitPaybill = 0;
      let customerId = '';
      let customerMatchName = '';

      if (r.soldTo) {
        mode = 'credit';
        const match = findBestMatch(r.soldTo, customers, (c) => c.name);
        if (match) {
          customerId = match.item.id;
          customerMatchName = match.item.name;
          flags.push(`Matched customer "${r.soldTo}" to "${match.item.name}" - please confirm this is the right customer.`);
        } else {
          flags.push(`Sold To "${r.soldTo}" - no matching customer found. Pick one or quick-add it.`);
        }
      } else if (payments.length > 1) {
        mode = 'split';
        for (const p of payments) {
          if (p.mode === 'mpesa') splitMpesa += p.amount;
          else if (p.mode === 'cash') splitCash += p.amount;
          else if (p.mode === 'paybill') splitPaybill += p.amount;
          else flags.push(`Could not recognise payment method "${p.label}".`);
        }
        if (commission > 0) {
          // The split amounts summed to the source's smaller (post-commission)
          // Total. Bump the largest bucket so the split still adds up to the
          // corrected Selling Price - which wallet really covered the
          // commission is a guess, so it's flagged either way.
          const buckets: Array<['mpesa' | 'cash' | 'paybill', number]> = [
            ['mpesa', splitMpesa], ['cash', splitCash], ['paybill', splitPaybill],
          ];
          buckets.sort((a, b) => b[1] - a[1]);
          const biggest = buckets[0][0];
          if (biggest === 'mpesa') splitMpesa += commission;
          else if (biggest === 'cash') splitCash += commission;
          else splitPaybill += commission;
          flags.push(`Added the KES ${commission.toLocaleString()} commission into the ${biggest} split amount as a guess - check which wallet it really came from.`);
        }
      } else if (payments.length === 1) {
        mode = payments[0].mode || 'cash';
        if (!payments[0].mode) flags.push(`Could not recognise payment method "${payments[0].label}" - defaulted to Cash.`);
      } else {
        flags.push('No payment method found in the paste - defaulted to Cash.');
      }

      if (commission > 0) flags.push("Source doesn't say which wallet paid the commission - Commission Mode needs picking.");

      const posTag = r.posId ? `[POS #${r.posId}] ` : '';
      const duplicate = !!r.posId && sales.some((s) => !s.is_void && s.notes?.includes(`[POS #${r.posId}]`));

      return {
        posId: r.posId,
        date: r.date,
        sellingPrice,
        costPrice: r.costOfGoods,
        profit: sellingPrice - r.costOfGoods,
        commission,
        mode,
        customerId,
        customerMatchName,
        splitMpesa, splitCash, splitPaybill,
        notes: (posTag + r.comments).trim(),
        flags,
        duplicate,
      };
    });

    const parsedExcel = parseExcelSmartEntryText(smartEntryPaste, new Date().getFullYear());
    const excelPreview: SmartPreviewRow[] = parsedExcel.map((r) => {
      const flags: string[] = ['From the Excel-style paste - please double check.'];

      let mode: SaleMode = 'cash';
      const modeLower = r.modeStr.toLowerCase();
      if (modeLower === 'cash' || modeLower === 'mpesa' || modeLower === 'paybill') {
        mode = modeLower as SaleMode;
      } else if (!r.modeStr) {
        mode = 'credit';
        flags.push('No mode given - defaulted to Credit. Please check and set the correct mode.');
      } else {
        flags.push(`Could not recognise mode "${r.modeStr}" - defaulted to Cash.`);
      }

      // Cost Price and Profit fill each other in when only one is missing -
      // same 3-way relationship as the regular Sale form.
      let costPrice = r.costPrice;
      let profit = r.profit;
      if (costPrice === null && profit !== null) {
        costPrice = r.sellingPrice - profit;
      } else if (profit === null && costPrice !== null) {
        profit = r.sellingPrice - costPrice;
      } else if (costPrice === null && profit === null) {
        costPrice = 0;
        profit = r.sellingPrice;
        flags.push('Cost Price not given - profit will show as the full Selling Price until you fill it in.');
      }

      const pct = detectPercentCommission(r.comments);
      if (pct !== null) {
        flags.push(`Comment mentions a ${pct}% deduction - please check Commission and Selling Price are correct.`);
      }
      if (r.commission > 0) {
        flags.push("Doesn't say which wallet paid the commission - Commission Mode needs picking.");
      }

      // Credit mode still needs a customer to attach to - fuzzy-match off any
      // name mentioned in the comment, same courtesy as the POS format's Sold To.
      let customerId = '';
      let customerMatchName = '';
      if (mode === 'credit' && r.comments) {
        const match = findBestMatch(r.comments, customers, (c) => c.name);
        if (match) {
          customerId = match.item.id;
          customerMatchName = match.item.name;
          flags.push(`Matched a name in the comment to customer "${match.item.name}" - please confirm.`);
        } else {
          flags.push('Credit mode but no matching customer found in the comment - pick one or quick-add it.');
        }
      }

      return {
        posId: null,
        date: r.date,
        sellingPrice: r.sellingPrice,
        costPrice: costPrice || 0,
        profit: profit || 0,
        commission: r.commission,
        mode,
        customerId,
        customerMatchName,
        splitMpesa: 0, splitCash: 0, splitPaybill: 0,
        notes: r.comments,
        flags,
        duplicate: false,
      };
    });

    setSmartEntryPreview([...posPreview, ...excelPreview]);
  }

  function handleAddSmartEntryToBulk() {
    const toAdd = smartEntryPreview.filter((r) => !r.duplicate);
    const forms: SaleForm[] = toAdd.map((r) => ({
      ...emptyForm,
      date: r.date,
      mode: r.mode,
      sellingPrice: r.sellingPrice ? String(r.sellingPrice) : '',
      costPrice: r.costPrice ? String(r.costPrice) : '',
      profit: String(r.profit),
      commission: r.commission ? String(r.commission) : '',
      customerId: r.customerId,
      splitMpesa: r.splitMpesa ? String(r.splitMpesa) : '',
      splitCash: r.splitCash ? String(r.splitCash) : '',
      splitPaybill: r.splitPaybill ? String(r.splitPaybill) : '',
      notes: r.notes,
      smartFlags: r.flags,
    }));
    if (forms.length === 0) return;
    setBulkForms(forms);
    setBulkTxnIds([]);
    setShowBulk(true);
    setShowSmartEntry(false);
    setSmartEntryPreview([]);
    setSmartEntryPaste('');
  }

  async function handleVoid(id: string, reason: string) {
    const txn = sales.find((s) => s.id === id);
    if (!txn) return;
    const result = await voidSale(txn, reason);
    if (!result.ok) { alert(result.error); return; }
    fetchData();
    triggerRefresh();
  }

  // How much of a sale is still refundable - the original amount minus
  // whatever's already been refunded against it (tracked via refunded_of,
  // not by matching description text).
  function alreadyRefunded(sale: Transaction): number {
    return sales
      .filter((s) => s.refunded_of === sale.transaction_id && !s.is_void)
      .reduce((sum, s) => sum + Math.abs(s.selling_price ?? s.amount ?? 0), 0);
  }

  function refundableAmount(sale: Transaction): number {
    const original = Math.abs(sale.selling_price ?? sale.amount ?? 0);
    return Math.max(0, original - alreadyRefunded(sale));
  }

  // Refund Amount/Cost Price/Profit auto-fill each other the same way the main
  // Sales form does (Amount stands in for Selling Price here) - type any 2,
  // the 3rd works itself out; whichever box you actually type into wins.
  function refundFilled(v: string): boolean {
    return v !== undefined && v !== null && v.trim() !== '';
  }

  function handleRefundAmountChange(value: string) {
    const amt = parseFloat(value || '0');
    setRefundForm((prev) => {
      if (refundFilled(prev.costPrice)) {
        return { ...prev, amount: value, profit: String(amt - parseFloat(prev.costPrice)) };
      } else if (refundFilled(prev.profit)) {
        return { ...prev, amount: value, costPrice: String(amt - parseFloat(prev.profit)) };
      }
      return { ...prev, amount: value };
    });
  }

  function handleRefundCPChange(value: string) {
    const cp = parseFloat(value || '0');
    setRefundForm((prev) => {
      if (refundFilled(prev.amount)) {
        return { ...prev, costPrice: value, profit: String(parseFloat(prev.amount) - cp) };
      } else if (refundFilled(prev.profit)) {
        return { ...prev, costPrice: value, amount: String(cp + parseFloat(prev.profit)) };
      }
      return { ...prev, costPrice: value };
    });
  }

  function handleRefundProfitChange(value: string) {
    const profit = parseFloat(value || '0');
    setRefundForm((prev) => {
      if (refundFilled(prev.amount)) {
        return { ...prev, profit: value, costPrice: String(parseFloat(prev.amount) - profit) };
      } else if (refundFilled(prev.costPrice)) {
        return { ...prev, profit: value, amount: String(parseFloat(prev.costPrice) + profit) };
      }
      return { ...prev, profit: value };
    });
  }

  async function handleRefund() {
    if (saving) return;
    if (!refundingSale) return;
    const amount = parseFloat(refundForm.amount);
    if (!amount || amount <= 0) {
      alert('Enter an Amount to refund before saving.');
      return;
    }

    const maxRefundable = refundableAmount(refundingSale);
    if (amount > maxRefundable) {
      alert(`You can refund at most KES ${formatKES(maxRefundable)} on this sale (KES ${formatKES(alreadyRefunded(refundingSale))} already refunded).`);
      return;
    }
    // A mixed sale (part Advance/Credit/Supplier, part real cash via an
    // Extra Payment Line) can't be safely partial-refunded here - there's no
    // clean way to say which part the refund amount comes out of. Void it
    // and re-enter it instead, same as the settlement-split guard elsewhere.
    if (refundingSale.primary_mode === 'split' && (refundingSale.customer_id || refundingSale.supplier_id)) {
      alert('This sale was paid using more than one source (part Advance/Credit/Supplier, part real cash) - it can\'t be refunded here. Void it and re-enter it instead.');
      return;
    }
    setSaving(true);
    try {

    // Use the cost price you entered if given; otherwise work out this
    // refund's share of the original cost automatically, so a partial refund
    // only reverses that portion of the profit, and a full refund reverses it all
    let refundCp: number;
    if (refundForm.costPrice) {
      refundCp = parseFloat(refundForm.costPrice);
    } else {
      const originalSp = refundingSale.selling_price || 0;
      const originalCp = refundingSale.cost_price || 0;
      refundCp = originalSp > 0 ? (amount / originalSp) * originalCp : 0;
    }

    // A credit/advance/supplier sale never moved physical cash, so its refund
    // shouldn't either - it just reverses the balance the original sale
    // affected. Only a cash/mpesa/paybill/split sale's refund actually pays
    // cash back out of a wallet, using whichever wallet was chosen above.
    const isWalletMode = ['cash', 'mpesa', 'paybill', 'split'].includes(refundingSale.primary_mode || '');
    const refundMode = isWalletMode ? refundForm.mode : refundingSale.primary_mode;

    const prefix = 'REF-' + refundForm.date.replace(/-/g, '');
    const { data: newTxn, error } = await insertTransactionWithId(prefix, (transactionId) => ({
      transaction_id: transactionId,
      date: refundForm.date,
      type: 'sale',
      primary_mode: refundMode,
      settlement_mode: refundingSale.primary_mode === 'advance' ? refundingSale.settlement_mode : null,
      selling_price: -amount,
      cost_price: -refundCp,
      amount: -amount,
      customer_id: refundingSale.customer_id || null,
      supplier_id: refundingSale.supplier_id || null,
      refunded_of: refundingSale.transaction_id,
      description: `Refund - ${refundingSale.transaction_id}`,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) {
      console.error(error);
      alert('Failed to save refund: ' + (error?.message || 'unknown error'));
      return;
    }

    if (!isWalletMode) {
      if (refundingSale.primary_mode === 'credit' && refundingSale.customer_id) {
        await adjustCustomerCredit(refundingSale.customer_id, -amount);
      } else if (refundingSale.primary_mode === 'advance' && refundingSale.customer_id) {
        await adjustCustomerAdvance(refundingSale.customer_id, amount);
      } else if (refundingSale.primary_mode === 'supplier' && refundingSale.supplier_id) {
        await adjustSupplierBalance(refundingSale.supplier_id, amount);
      }
    }

    // A full refund (nothing left refundable) means the sale is completely
    // reversed, so also reverse a linked "pay cost to supplier now" pair,
    // the same way handleVoid does - a partial refund leaves it alone since
    // there's no clean way to partially reverse it.
    if (amount >= maxRefundable) {
      const { data: linked } = await supabase
        .from('transactions')
        .select('*')
        .in('type', ['supplier_invoice', 'supplier_payment'])
        .eq('is_void', false)
        .or(`description.eq.Cost price taken on sale ${refundingSale.transaction_id},description.eq.Cost price paid on sale ${refundingSale.transaction_id}`);
      if (linked && linked.length > 0) {
        for (const lt of linked) {
          if (lt.type === 'supplier_invoice' && lt.supplier_id) {
            await adjustSupplierBalance(lt.supplier_id, -(lt.amount || 0));
          } else if (lt.type === 'supplier_payment' && lt.supplier_id) {
            await adjustSupplierBalance(lt.supplier_id, lt.amount || 0);
            await undoSettlementForTransaction(lt.transaction_id, lt.supplier_id, null);
          }
        }
        await supabase
          .from('transactions')
          .update({ is_void: true, void_reason: `Refunded - ${refundingSale.transaction_id}` })
          .in('id', linked.map((lt) => lt.id));
      }
    }

    setRefundingSale(null);
    setRefundForm({ amount: '', costPrice: '', profit: '', mode: 'cash', date: todayStr() });
    fetchData();
    triggerRefresh();
    } finally {
      setSaving(false);
    }
  }

  // Reverses whatever the old version of this sale did to a customer/supplier
  // balance, writes the new form's values in place, replaces its split
  // breakdown, and applies the new balance effects - the whole "edit one
  // sale" operation, shared by the single Edit form and reopening a Bulk
  // Add Sale batch to edit several at once.
  async function applySaleUpdate(oldTxn: Transaction, f: SaleForm): Promise<{ ok: boolean; error?: string }> {
    const sp = parseFloat(f.sellingPrice);
    const cp = parseFloat(f.costPrice || '0');
    const comm = parseFloat(f.commission || '0');

    // Reverse whatever the old version drew from Advance/Credit/Supplier -
    // either a plain single-mode sale, or (if it was a 'split' sale with an
    // Extra Payment Line) the one non-cash portion of it (settlement_mode
    // set = that portion was Advance, unset = it was Credit).
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
    if (oldTxn.primary_mode === 'split' && (oldTxn.customer_id || oldTxn.supplier_id)) {
      const oldRealSum = splits
        .filter((s) => s.transaction_id === oldTxn.transaction_id && (s.mode === 'cash' || s.mode === 'mpesa' || s.mode === 'paybill'))
        .reduce((s, x) => s + x.amount, 0);
      const oldNonCash = (oldTxn.amount || 0) - oldRealSum;
      if (oldNonCash > 0.01) {
        if (oldTxn.customer_id && oldTxn.settlement_mode) await adjustCustomerAdvance(oldTxn.customer_id, oldNonCash);
        else if (oldTxn.customer_id) await adjustCustomerCredit(oldTxn.customer_id, -oldNonCash);
        else if (oldTxn.supplier_id) await adjustSupplierBalance(oldTxn.supplier_id, oldNonCash);
      }
    }

    const usesExtraLines = f.extraLines.length > 0;
    let lines: ReturnType<typeof resolvePaymentLines> | null = null;
    if (usesExtraLines) {
      lines = resolvePaymentLines(f);
      if (lines.error) return { ok: false, error: lines.error + ' The old balances were already reversed - please reopen this sale and try again.' };
    }

    const primaryMode = usesExtraLines ? 'split' : f.mode;
    const settlementMode = usesExtraLines
      ? (lines!.nonCash?.mode === 'advance' ? f.advanceMode : null)
      : (f.mode === 'advance' ? f.advanceMode : null);
    const customerIdForRow = usesExtraLines
      ? (lines!.nonCash?.mode === 'advance' || lines!.nonCash?.mode === 'credit' ? (f.customerId || null) : null)
      : (f.mode === 'credit' || f.mode === 'advance' ? (f.customerId || null) : null);
    const supplierIdForRow = usesExtraLines
      ? (lines!.nonCash?.mode === 'supplier' ? (f.supplierId || null) : null)
      : (f.mode === 'supplier' ? (f.supplierId || null) : null);

    const { error: updateError } = await supabase.from('transactions').update({
      date: f.date,
      primary_mode: primaryMode,
      settlement_mode: settlementMode,
      amount: sp,
      description: f.notes || null,
      notes: !usesExtraLines && f.mode === 'advance' ? `Advance payment via ${f.advanceMode}${f.notes ? ' | ' + f.notes : ''}` : (f.notes || null),
      selling_price: sp,
      cost_price: cp || null,
      commission: comm || null,
      commission_mode: comm > 0 ? f.commissionMode : null,
      is_unclassified: f.isUnclassified,
      customer_id: customerIdForRow,
      supplier_id: supplierIdForRow,
      edited_at: new Date().toISOString(),
    }).eq('id', oldTxn.id);

    if (updateError) {
      console.error(updateError);
      return { ok: false, error: updateError.message + '. The old balances were already reversed - please reopen this sale and try again.' };
    }

    // Replace the split breakdown to match the (possibly new) mode/amounts -
    // old rows are cleared first so switching away from split mode, or
    // changing the amounts, never leaves a stale/mismatched breakdown behind
    await supabase.from('transaction_splits').delete().eq('transaction_id', oldTxn.transaction_id);
    if (usesExtraLines) {
      const splitRows = lines!.cashLines.map((l) => ({ transaction_id: oldTxn.transaction_id, mode: l.mode, amount: l.amount }));
      if (splitRows.length > 0) await supabase.from('transaction_splits').insert(splitRows);

      if (lines!.nonCash?.mode === 'advance' && f.customerId) {
        await adjustCustomerAdvance(f.customerId, -lines!.nonCash.amount);
      } else if (lines!.nonCash?.mode === 'credit' && f.customerId) {
        await adjustCustomerCredit(f.customerId, lines!.nonCash.amount);
      } else if (lines!.nonCash?.mode === 'supplier' && f.supplierId) {
        await adjustSupplierBalance(f.supplierId, -lines!.nonCash.amount);
      }
    } else {
    if (f.mode === 'split') {
      const newSplits = [];
      if (parseFloat(f.splitMpesa || '0') > 0) newSplits.push({ transaction_id: oldTxn.transaction_id, mode: 'mpesa', amount: parseFloat(f.splitMpesa) });
      if (parseFloat(f.splitCash || '0') > 0) newSplits.push({ transaction_id: oldTxn.transaction_id, mode: 'cash', amount: parseFloat(f.splitCash) });
      if (parseFloat(f.splitPaybill || '0') > 0) newSplits.push({ transaction_id: oldTxn.transaction_id, mode: 'paybill', amount: parseFloat(f.splitPaybill) });
      if (newSplits.length > 0) await supabase.from('transaction_splits').insert(newSplits);
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

    await syncCommissionExpense(oldTxn.transaction_id, f.date, comm, f.commissionMode, user?.username || null);
    return { ok: true };
  }

  async function handleUpdate() {
    if (saving) return;
    if (!editingId) return;
    const oldTxn = sales.find((s) => s.id === editingId);
    if (!oldTxn) return;
    if (!form.sellingPrice || parseFloat(form.sellingPrice) <= 0) {
      alert('Enter a Selling Price before saving.');
      return;
    }
    if ((form.mode === 'credit' || form.mode === 'advance' || form.extraLines.some((l) => l.mode === 'credit' || l.mode === 'advance')) && !form.customerId) {
      const keepEditing = confirm('No Customer picked. Click OK to go back and pick one, or Cancel to close without saving.');
      if (!keepEditing) { setShowAdd(false); setEditingId(null); }
      return;
    }
    if ((form.mode === 'supplier' || form.extraLines.some((l) => l.mode === 'supplier')) && !form.supplierId) {
      const keepEditing = confirm('No Supplier picked. Click OK to go back and pick one, or Cancel to close without saving.');
      if (!keepEditing) { setShowAdd(false); setEditingId(null); }
      return;
    }
    if (form.mode === 'split') {
      const splitTotal = parseFloat(form.splitMpesa || '0') + parseFloat(form.splitCash || '0') + parseFloat(form.splitPaybill || '0');
      if (splitTotal <= 0 && form.extraLines.length === 0) {
        alert('Enter how much was paid via Mpesa, Cash, and/or Paybill for this split sale - it cannot be saved with nothing entered, or the money would silently disappear from your balance.');
        return;
      }
    }
    if (form.extraLines.some((l) => parseFloat(l.amount || '0') <= 0)) {
      alert('Every extra payment line needs an amount before saving - remove any empty ones.');
      return;
    }
    setSaving(true);
    try {

    const result = await applySaleUpdate(oldTxn, form);
    if (!result.ok) {
      alert('Failed to save changes: ' + result.error);
      setEditingId(null);
      setForm(emptyForm);
      setShowAdd(false);
      fetchData();
      triggerRefresh();
      return;
    }

    setEditingId(null);
    setForm(emptyForm);
    setShowAdd(false);
    fetchData();
    triggerRefresh();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(sale: Transaction) {
    // A sale entered through Bulk Add Sale reopens as that same batch (every
    // sale saved alongside it, found via findBulkBatch) instead of one row
    // at a time - matches how it was actually entered. The pay-cost-to-
    // supplier flow is create-time-only convenience and isn't reconstructed.
    const batch = findBulkBatch(sales, sale, 'sale');
    if (batch.length > 1) {
      const sorted = [...batch].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      setBulkForms(sorted.map((b) => {
        const existingSplits = splits.filter((s) => s.transaction_id === b.transaction_id);
        return {
          date: b.date,
          mode: (b.primary_mode as SaleMode) || 'cash',
          sellingPrice: String(b.selling_price || ''),
          costPrice: String(b.cost_price || ''),
          profit: b.cost_price !== null && b.cost_price !== undefined ? String((b.selling_price || 0) - b.cost_price) : '',
          commission: String(b.commission || ''),
          commissionMode: b.commission_mode || 'cash',
          notes: b.primary_mode === 'advance' ? (b.description || '') : (b.description || b.notes || ''),
          customerId: b.customer_id || '',
          supplierId: b.supplier_id || '',
          splitMpesa: String(existingSplits.find((s) => s.mode === 'mpesa')?.amount || ''),
          splitCash: String(existingSplits.find((s) => s.mode === 'cash')?.amount || ''),
          splitPaybill: String(existingSplits.find((s) => s.mode === 'paybill')?.amount || ''),
          isUnclassified: b.is_unclassified,
          advanceMode: b.settlement_mode || 'cash',
          payCostToSupplier: false,
          costSuppliers: [],
          extraLines: reconstructExtraLines(b, existingSplits),
          overpayCustomerId: '',
          overpayAmount: '',
          overpayMode: 'cash',
          setReminder: false,
          reminderDate: '',
          reminderTime: '09:00',
        };
      }));
      setBulkTxnIds(sorted.map((b) => b.id));
      setShowAdd(false);
      setShowBulk(true);
      return;
    }

    setEditingId(sale.id);
    const existingSplits = splits.filter((s) => s.transaction_id === sale.transaction_id);
    setForm({
      date: sale.date,
      mode: (sale.primary_mode as SaleMode) || 'cash',
      sellingPrice: String(sale.selling_price || ''),
      costPrice: String(sale.cost_price || ''),
      profit: sale.cost_price !== null && sale.cost_price !== undefined ? String((sale.selling_price || 0) - sale.cost_price) : '',
      commission: String(sale.commission || ''),
      commissionMode: sale.commission_mode || 'cash',
      notes: sale.primary_mode === 'advance' ? (sale.description || '') : (sale.description || sale.notes || ''),
      customerId: sale.customer_id || '',
      supplierId: sale.supplier_id || '',
      splitMpesa: String(existingSplits.find((s) => s.mode === 'mpesa')?.amount || ''),
      splitCash: String(existingSplits.find((s) => s.mode === 'cash')?.amount || ''),
      splitPaybill: String(existingSplits.find((s) => s.mode === 'paybill')?.amount || ''),
      isUnclassified: sale.is_unclassified,
      advanceMode: sale.settlement_mode || 'cash',
      payCostToSupplier: false,
      costSuppliers: [],
      extraLines: reconstructExtraLines(sale, existingSplits),
      overpayCustomerId: '',
      overpayAmount: '',
      overpayMode: 'cash',
      setReminder: false,
      reminderDate: '',
      reminderTime: '09:00',
    });
    setShowAdd(true);
  }

  const { from: rangeFrom, to: rangeTo } = getDatePresetRange(datePreset, customFrom, customTo);
  const grouped = new Map<string, Transaction[]>();
  const filtered = sales.filter((s) => {
    if (s.is_void) return false;
    if (search && !s.description?.toLowerCase().includes(search.toLowerCase()) && !s.transaction_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterMode && s.primary_mode !== filterMode) return false;
    if (s.date < rangeFrom || s.date > rangeTo) return false;
    return true;
  });

  filtered.forEach((s) => {
    if (!grouped.has(s.date)) grouped.set(s.date, []);
    grouped.get(s.date)!.push(s);
  });

  const sortedDates = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  // Only rows currently visible (their date group expanded) can be browsed
  // with arrow keys - a collapsed group has nothing on screen to move into.
  const visibleSales = sortedDates.filter((d) => expandedDates.has(d)).flatMap((d) => grouped.get(d) || []);

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    if (visibleSales.length === 0) return;
    e.preventDefault();

    if (e.key === 'Enter') {
      const current = visibleSales.find((s) => s.id === highlightedSaleId);
      if (current) startEdit(current);
      return;
    }

    const currentIdx = visibleSales.findIndex((s) => s.id === highlightedSaleId);
    if (e.key === 'ArrowDown') {
      const next = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, visibleSales.length - 1);
      setHighlightedSaleId(visibleSales[next].id);
    } else if (e.key === 'ArrowUp') {
      const prev = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
      setHighlightedSaleId(visibleSales[prev].id);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { setShowAdd(true); setShowBulk(false); setBulkTxnIds([]); setEditingId(null); setForm({ ...emptyForm, date: todayStr() }); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus size={16} /> Add Sale
        </button>
        <button
          onClick={() => { setShowBulk(true); setShowAdd(false); setShowSmartEntry(false); setEditingId(null); setBulkForms(Array.from({ length: 10 }, () => ({ ...emptyForm, date: todayStr() }))); setBulkTxnIds([]); }}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus size={16} /> Bulk Entry
        </button>
        <button
          onClick={() => { setShowSmartEntry(true); setShowAdd(false); setShowBulk(false); setBulkTxnIds([]); setEditingId(null); }}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus size={16} /> Smart Entry
        </button>
        <button
          onClick={() => setShowLedger(true)}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <BookOpen size={16} /> View Ledger
        </button>
        <button
          onClick={() => { setShowDepositAdvance(true); setAdvanceDepositForm({ customerId: '', amount: '', date: todayStr(), mode: 'cash', notes: '' }); }}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Wallet size={16} /> Deposit Advance
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
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Clear search
          </button>
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

      {/* Add/Edit Modal - a real popup, so it's visible no matter how far down the page you've scrolled */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowAdd(false); setEditingId(null); } }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-sale-form>
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
            allTransactions={allTransactions}
            shareRules={shareRules}
            historicalProfit={historicalProfit}
            onSave={editingId ? handleUpdate : handleSave}
            onCancel={() => { setShowAdd(false); setEditingId(null); }}
            saveLabel={editingId ? 'Update' : 'Save'}
            saving={saving}
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
            costSupplierQuickAddIndex={costSupplierQuickAddIndex}
            setCostSupplierQuickAddIndex={setCostSupplierQuickAddIndex}
            quickCostSupplier={quickCostSupplier}
            setQuickCostSupplier={setQuickCostSupplier}
            onQuickAddCostSupplier={handleQuickAddCostSupplier}
            isEditing={!!editingId}
            onKeyDown={(e) => {
              // SaleFormFields only hands off here once focus reaches the
              // very last box and Enter is pressed - everything before that
              // is arrow/Enter navigation it already handled itself.
              if (e.key === 'Enter') {
                (editingId ? handleUpdate : handleSave)();
              }
            }}
          />
        </div>
        </div>
      )}

      {/* Smart Entry - paste a sales export from elsewhere, review the parsed
          rows here, then hand them to Bulk Entry (already filled in) for the
          real editing and Save All - its own tab, not mixed into Bulk Entry. */}
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
            Paste rows copied from another sales sheet or system. This reads them and works out Date, Selling Price, Cost Price, Commission, and Mode for you - nothing is saved until you send them to Bulk Entry and press Save All there.
          </p>
          <textarea
            value={smartEntryPaste}
            onChange={(e) => setSmartEntryPaste(e.target.value)}
            placeholder="Paste your sales export here..."
            rows={8}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSmartEntryParse}
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
                {smartEntryPreview.length} parsed
                {smartEntryPreview.some((r) => r.flags.length > 0) && `, ${smartEntryPreview.filter((r) => r.flags.length > 0).length} need a check`}
                {smartEntryPreview.some((r) => r.duplicate) && `, ${smartEntryPreview.filter((r) => r.duplicate).length} already imported (skipped)`}
              </span>
            )}
          </div>

          {smartEntryPreview.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 max-h-96 overflow-y-auto">
              {smartEntryPreview.map((r, i) => (
                <div
                  key={i}
                  className={`border rounded p-2 text-xs ${r.duplicate ? 'border-slate-200 bg-slate-50 opacity-60' : r.flags.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-medium text-slate-700">{r.date}</span>
                    <span className="text-slate-500">SP {formatKES(r.sellingPrice)}</span>
                    <span className="text-slate-500">CP {formatKES(r.costPrice)}</span>
                    <span className="text-slate-500">Profit {formatKES(r.profit)}</span>
                    {r.commission > 0 && <span className="text-slate-500">Commission {formatKES(r.commission)}</span>}
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 capitalize">{r.mode}</span>
                    {r.customerMatchName && <span className="text-slate-500">→ {r.customerMatchName}</span>}
                    {r.duplicate && <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">Already imported</span>}
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
                onClick={handleAddSmartEntryToBulk}
                disabled={smartEntryPreview.every((r) => r.duplicate)}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium"
              >
                Add to Bulk Entry →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bulk entry - one shared data-sale-form scope across all rows, so arrow keys/Enter
          flow straight from one row's last box into the next row's first box */}
      {showBulk && (
        <div
          className="bg-white rounded-xl border border-slate-200 shadow-lg p-4"
          data-sale-form
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowBulk(false); setBulkTxnIds([]); } }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">{bulkTxnIds.length > 0 ? 'Edit Bulk Entry' : 'Bulk Entry'}</h3>
            <button onClick={() => { setShowBulk(false); setBulkTxnIds([]); }} className="p-1 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-2">
            {bulkForms.map((f, i) => (
              <div key={i} className={`border rounded p-2 ${f.smartFlags?.length ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
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
                {f.smartFlags && f.smartFlags.length > 0 && (
                  <ul className="text-xs text-amber-700 list-disc list-inside mb-2 space-y-0.5">
                    {f.smartFlags.map((flag, fi) => <li key={fi}>{flag}</li>)}
                  </ul>
                )}
                <SaleFormFields
                  form={f}
                  setForm={(updater) => {
                    const newForms = [...bulkForms];
                    const prevRow = newForms[i];
                    const updatedRow = typeof updater === 'function' ? updater(prevRow) : updater;
                    newForms[i] = updatedRow;
                    // Row 1's date drives every other row's date too - each
                    // row can still be changed individually after that.
                    if (i === 0 && updatedRow.date !== prevRow.date) {
                      for (let j = 1; j < newForms.length; j++) {
                        newForms[j] = { ...newForms[j], date: updatedRow.date };
                      }
                    }
                    setBulkForms(newForms);
                  }}
                  customers={customers}
                  suppliers={suppliers}
                  allTransactions={allTransactions}
                  shareRules={shareRules}
                  historicalProfit={historicalProfit}
                  onSave={() => {}}
                  onCancel={() => {}}
                  saveLabel=""
                  hideActions
                  showQuickAddCustomer={bulkQuickAddCustomerRow === i}
                  setShowQuickAddCustomer={(v) => setBulkQuickAddCustomerRow(v ? i : null)}
                  quickCustomer={quickCustomer}
                  setQuickCustomer={setQuickCustomer}
                  onQuickAddCustomer={() => handleBulkQuickAddCustomer(i)}
                  showQuickAddSupplier={bulkQuickAddSupplierRow === i}
                  setShowQuickAddSupplier={(v) => setBulkQuickAddSupplierRow(v ? i : null)}
                  quickSupplier={quickSupplier}
                  setQuickSupplier={setQuickSupplier}
                  onQuickAddSupplier={() => handleBulkQuickAddSupplier(i)}
                  costSupplierQuickAddIndex={bulkQuickAddCostSupplierRow?.row === i ? bulkQuickAddCostSupplierRow.idx : null}
                  setCostSupplierQuickAddIndex={(idx) => setBulkQuickAddCostSupplierRow(idx === null ? null : { row: i, idx })}
                  quickCostSupplier={quickCostSupplier}
                  setQuickCostSupplier={setQuickCostSupplier}
                  onQuickAddCostSupplier={(subIndex) => handleBulkQuickAddCostSupplier(i, subIndex)}
                  onKeyDown={(e) => {
                    // Reaches here only once focus is on this row's very
                    // last box and Enter is pressed - move on to a new row.
                    if (e.key === 'Enter' && i === bulkForms.length - 1) {
                      setBulkForms([...bulkForms, { ...emptyForm, date: bulkForms[0]?.date || todayStr() }]);
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-3 pt-3 border-t border-slate-200">
            <button
              onClick={() => setBulkForms([...bulkForms, { ...emptyForm, date: bulkForms[0]?.date || todayStr() }])}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded text-sm font-medium flex items-center gap-1"
            >
              <Plus size={14} /> Add Row
            </button>
            <button onClick={handleBulkSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium">
              {saving ? 'Saving...' : 'Save All'}
            </button>
            <button onClick={() => { setShowBulk(false); setBulkTxnIds([]); }} className="text-slate-500 hover:text-slate-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sales List - click anywhere in here, then use Up/Down to browse entries, Enter to edit the highlighted one */}
      <div
        className="bg-white rounded-xl border border-slate-200 shadow-sm outline-none"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
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
              const dayProfit = daySales.reduce((s, sale) => s + saleProfit(sale), 0);

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
                    <div className="bg-slate-50 overflow-x-auto">
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
                            const profit = saleProfit(sale);
                            const incomplete = isSaleIncomplete(sale);
                            return (
                              <tr
                                key={sale.id}
                                className={`hover:bg-white transition-colors ${sale.id === highlightedSaleId ? 'bg-emerald-100' : incomplete ? 'bg-green-50' : ''}`}
                                title={incomplete ? 'Missing payment mode, cost price, or selling price' : undefined}
                              >
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
                                    {sale.primary_mode}{sale.primary_mode === 'advance' && sale.settlement_mode ? ` (${sale.settlement_mode})` : ''}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {sale.description || '-'}
                                  {sale.created_by && (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Added by">
                                      {sale.created_by}
                                    </span>
                                  )}
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
                                    {!sale.refunded_of && refundableAmount(sale) > 0 && (
                                      <button
                                        onClick={() => {
                                          setRefundingSale(sale);
                                          setRefundForm({ amount: '', costPrice: '', profit: '', mode: 'cash', date: todayStr() });
                                        }}
                                        className="p-1 hover:bg-amber-100 rounded"
                                        title="Refund"
                                      >
                                        <RotateCcw size={14} className="text-amber-600" />
                                      </button>
                                    )}
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
        filterTypes={['sale', 'customer_payment']}
      />

      {/* Deposit Advance modal */}
      {showDepositAdvance && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Deposit Customer Advance</h3>
              <button onClick={() => setShowDepositAdvance(false)} className="p-1 hover:bg-slate-100 rounded">
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Customer</label>
              <select
                value={advanceDepositForm.customerId}
                onChange={(e) => setAdvanceDepositForm({ ...advanceDepositForm, customerId: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Select customer</option>
                {sortCustomersByBalance(customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount</label>
                <input
                  type="number"
                  value={advanceDepositForm.amount}
                  onChange={(e) => setAdvanceDepositForm({ ...advanceDepositForm, amount: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={advanceDepositForm.date}
                  onChange={(e) => setAdvanceDepositForm({ ...advanceDepositForm, date: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mode</label>
              <select
                value={advanceDepositForm.mode}
                onChange={(e) => setAdvanceDepositForm({ ...advanceDepositForm, mode: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="cash">Cash</option>
                <option value="mpesa">Mpesa</option>
                <option value="paybill">Paybill</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={advanceDepositForm.notes}
                onChange={(e) => setAdvanceDepositForm({ ...advanceDepositForm, notes: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleDepositAdvance} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded text-sm font-medium">
                Save
              </button>
              <button onClick={() => setShowDepositAdvance(false)} className="px-3 py-2 text-slate-500 hover:text-slate-700 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund modal */}
      {refundingSale && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Refund Sale {refundingSale.transaction_id}</h3>
              <button onClick={() => setRefundingSale(null)} className="p-1 hover:bg-slate-100 rounded">
                <X size={16} />
              </button>
            </div>
            {/* Original sale, shown in full so you know exactly what you're refunding against */}
            <div className="bg-slate-50 border border-slate-200 rounded p-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-500">SP</p>
                <p className="text-sm font-medium text-slate-800">{formatKES(refundingSale.selling_price || 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">CP</p>
                <p className="text-sm font-medium text-slate-800">{formatKES(refundingSale.cost_price || 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Profit</p>
                <p className="text-sm font-medium text-slate-800">{formatKES(saleProfit(refundingSale))}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Refundable: KES {formatKES(refundableAmount(refundingSale))}
              {alreadyRefunded(refundingSale) > 0 && ` (KES ${formatKES(alreadyRefunded(refundingSale))} already refunded)`}
            </p>
            {!['cash', 'mpesa', 'paybill', 'split'].includes(refundingSale.primary_mode || '') && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                This was a {refundingSale.primary_mode} sale - no cash changes hands, this will just reduce the {refundingSale.primary_mode === 'supplier' ? "supplier's" : "customer's"} balance.
              </p>
            )}
            {refundingSale.primary_mode === 'split' && (refundingSale.customer_id || refundingSale.supplier_id) && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                This sale was paid using more than one source (part Advance/Credit/Supplier, part real cash) - it can't be refunded here. Void it and re-enter it instead.
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount to refund</label>
              <input
                type="number"
                value={refundForm.amount}
                onChange={(e) => handleRefundAmountChange(e.target.value)}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            {/* Cost Price and Profit auto-fill each other, same rule as the Sales form -
                type one, the other works itself out; leave both blank for the automatic
                proportional guess (same share of cost as the amount is of the original sale) */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cost price (optional)</label>
                <input
                  type="number"
                  value={refundForm.costPrice}
                  onChange={(e) => handleRefundCPChange(e.target.value)}
                  placeholder="Auto if left blank"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Profit (optional)</label>
                <input
                  type="number"
                  value={refundForm.profit}
                  onChange={(e) => handleRefundProfitChange(e.target.value)}
                  placeholder="Auto if left blank"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {['cash', 'mpesa', 'paybill', 'split'].includes(refundingSale.primary_mode || '') && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Paid back via</label>
                  <select
                    value={refundForm.mode}
                    onChange={(e) => setRefundForm({ ...refundForm, mode: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="cash">Cash</option>
                    <option value="mpesa">Mpesa</option>
                    <option value="paybill">Paybill</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={refundForm.date}
                  onChange={(e) => setRefundForm({ ...refundForm, date: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleRefund} disabled={saving} className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-2 rounded text-sm font-medium">
                {saving ? 'Saving...' : 'Save Refund'}
              </button>
              <button onClick={() => setRefundingSale(null)} className="px-3 py-2 text-slate-500 hover:text-slate-700 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
  saving,
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
  costSupplierQuickAddIndex,
  setCostSupplierQuickAddIndex,
  quickCostSupplier,
  setQuickCostSupplier,
  onQuickAddCostSupplier,
  isEditing,
  onKeyDown,
  allTransactions,
  shareRules,
  historicalProfit,
}: {
  form: SaleForm;
  setForm: React.Dispatch<React.SetStateAction<SaleForm>>;
  customers: Customer[];
  suppliers: Supplier[];
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  saving?: boolean;
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
  costSupplierQuickAddIndex?: number | null;
  setCostSupplierQuickAddIndex?: (v: number | null) => void;
  quickCostSupplier?: { name: string; phone: string };
  setQuickCostSupplier?: (v: { name: string; phone: string }) => void;
  onQuickAddCostSupplier?: (subIndex: number) => void;
  isEditing?: boolean;
  onKeyDown?: (e: React.KeyboardEvent, field: keyof SaleForm) => void;
  allTransactions: Transaction[];
  shareRules: ShareRule[];
  historicalProfit: HistoricalProfit[];
}) {
  const profit = parseFloat(form.profit || '0');

  const update = (field: keyof SaleForm, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateCostSupplier = (idx: number, field: 'supplierId' | 'amount' | 'mode', value: string) => {
    setForm((prev) => {
      const costSuppliers = [...prev.costSuppliers];
      costSuppliers[idx] = { ...costSuppliers[idx], [field]: value };
      return { ...prev, costSuppliers };
    });
  };

  const updateCostSupplierSettlement = (idx: number, next: SettlementAmounts) => {
    setForm((prev) => {
      const costSuppliers = [...prev.costSuppliers];
      costSuppliers[idx] = { ...costSuppliers[idx], settlement: next };
      return { ...prev, costSuppliers };
    });
  };

  const addCostSupplierRow = () => {
    setForm((prev) => ({ ...prev, costSuppliers: [...prev.costSuppliers, { supplierId: '', amount: '', mode: 'cash', settlement: emptySettlementAmounts }] }));
  };

  const removeCostSupplierRow = (idx: number) => {
    setForm((prev) => ({ ...prev, costSuppliers: prev.costSuppliers.filter((_, i) => i !== idx) }));
  };

  // In Split mode the Selling Price is auto-derived from the payment boxes
  // (see handleSplitChange) - an extra line's amount changing the total
  // needs to recompute it here the same way. Every other mode has the user
  // type the Selling Price directly, so it's left alone there.
  const updateExtraLine = (idx: number, field: 'mode' | 'amount', value: string) => {
    setForm((prev) => {
      const extraLines = [...prev.extraLines];
      extraLines[idx] = { ...extraLines[idx], [field]: value } as PaymentLine;
      const updated = { ...prev, extraLines };
      if (prev.mode !== 'split' || field !== 'amount') return updated;
      const total = splitTotalWithExtra(updated);
      if (filled(prev.costPrice)) return { ...updated, sellingPrice: String(total), profit: String(total - parseFloat(prev.costPrice)) };
      if (filled(prev.profit)) return { ...updated, sellingPrice: String(total), costPrice: String(total - parseFloat(prev.profit)) };
      return { ...updated, sellingPrice: String(total) };
    });
  };

  const addExtraLine = () => {
    setForm((prev) => ({ ...prev, extraLines: [...prev.extraLines, { mode: 'cash', amount: '' }] }));
  };

  const removeExtraLine = (idx: number) => {
    setForm((prev) => {
      const extraLines = prev.extraLines.filter((_, i) => i !== idx);
      const updated = { ...prev, extraLines };
      if (prev.mode !== 'split') return updated;
      const total = splitTotalWithExtra(updated);
      if (filled(prev.costPrice)) return { ...updated, sellingPrice: String(total), profit: String(total - parseFloat(prev.costPrice)) };
      if (filled(prev.profit)) return { ...updated, sellingPrice: String(total), costPrice: String(total - parseFloat(prev.profit)) };
      return { ...updated, sellingPrice: String(total) };
    });
  };

  const filled = (v: string) => v !== undefined && v !== null && v.trim() !== '';

  // Any 2 of {Selling Price, Cost Price, Profit} filled in auto-fills the 3rd.
  // Whichever box you type into yourself always wins - this only ever
  // recomputes one of the OTHER two boxes, never the one just typed into.
  const handleSPChange = (value: string) => {
    const spNum = parseFloat(value || '0');
    setForm((prev) => {
      if (filled(prev.costPrice)) {
        return { ...prev, sellingPrice: value, profit: String(spNum - parseFloat(prev.costPrice)) };
      } else if (filled(prev.profit)) {
        return { ...prev, sellingPrice: value, costPrice: String(spNum - parseFloat(prev.profit)) };
      }
      return { ...prev, sellingPrice: value };
    });
  };

  const handleCPChange = (value: string) => {
    const cpNum = parseFloat(value || '0');
    setForm((prev) => {
      if (filled(prev.sellingPrice)) {
        return { ...prev, costPrice: value, profit: String(parseFloat(prev.sellingPrice) - cpNum) };
      } else if (filled(prev.profit)) {
        return { ...prev, costPrice: value, sellingPrice: String(cpNum + parseFloat(prev.profit)) };
      }
      return { ...prev, costPrice: value };
    });
  };

  const handleProfitChange = (value: string) => {
    const profitNum = parseFloat(value || '0');
    setForm((prev) => {
      if (filled(prev.sellingPrice)) {
        return { ...prev, profit: value, costPrice: String(parseFloat(prev.sellingPrice) - profitNum) };
      } else if (filled(prev.costPrice)) {
        return { ...prev, profit: value, sellingPrice: String(parseFloat(prev.costPrice) + profitNum) };
      }
      return { ...prev, profit: value };
    });
  };

  // Split mode's Selling Price is derived from the 3 mode amounts, same
  // override rule as SP/CP/Profit above - it stays in sync with whichever
  // split box you're typing into.
  // Split mode's Selling Price is the 3 mode boxes PLUS any Extra Payment
  // Lines added on top (e.g. Mpesa + Cash boxes filled, plus an Advance
  // extra line) - every place that can change either needs to recompute it.
  const splitTotalWithExtra = (f: SaleForm) => {
    const extraTotal = f.extraLines.reduce((s, l) => s + (parseFloat(l.amount || '0') || 0), 0);
    return parseFloat(f.splitMpesa || '0') + parseFloat(f.splitCash || '0') + parseFloat(f.splitPaybill || '0') + extraTotal;
  };

  const handleSplitChange = (field: 'splitMpesa' | 'splitCash' | 'splitPaybill', value: string) => {
    setForm((prev) => {
      const updated = { ...prev, [field]: value };
      const total = splitTotalWithExtra(updated);
      if (filled(prev.costPrice)) {
        return { ...updated, sellingPrice: String(total), profit: String(total - parseFloat(prev.costPrice)) };
      } else if (filled(prev.profit)) {
        return { ...updated, sellingPrice: String(total), costPrice: String(total - parseFloat(prev.profit)) };
      }
      return { ...updated, sellingPrice: String(total) };
    });
  };

  // Arrow keys move between boxes instead of needing the mouse - Down/Right
  // go to the next box, Up/Left to the previous one, scoped to just this
  // form (so Bulk Entry's rows don't jump into each other). Enter does the
  // same going forward, and once it reaches the last box, hands off to
  // whatever the parent wants to happen next (save, or add a new row).
  const handleKeyDown = (e: React.KeyboardEvent, field: keyof SaleForm) => {
    const forward = e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!forward && !backward) return;

    const target = e.target as HTMLElement;
    const scope = target.closest('[data-sale-form]');
    if (!scope) return;
    const inputs = Array.from(scope.querySelectorAll('input, select')) as HTMLElement[];
    const currentIdx = inputs.indexOf(target);
    if (currentIdx === -1) return;

    e.preventDefault();
    if (forward) {
      if (currentIdx < inputs.length - 1) {
        inputs[currentIdx + 1].focus();
      } else if (e.key === 'Enter') {
        onKeyDown?.(e, field);
      }
    } else if (currentIdx > 0) {
      inputs[currentIdx - 1].focus();
    }
  };

  return (
    <div className="space-y-2">
      {/* Row 1: Date, Mode, Customer/Supplier */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
          onKeyDown={(e) => handleKeyDown(e, 'mode')}
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
        {(form.mode === 'credit' || form.mode === 'advance' || form.extraLines.some((l) => l.mode === 'credit' || l.mode === 'advance')) && (
          <div className="col-span-2 flex gap-1">
            <select
              value={form.customerId}
              onChange={(e) => update('customerId', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'customerId')}
              className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Customer</option>
              {sortCustomersByBalance(customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        {(form.mode === 'supplier' || form.extraLines.some((l) => l.mode === 'supplier')) && (
          <div className="col-span-2 flex gap-1">
            <select
              value={form.supplierId}
              onChange={(e) => update('supplierId', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'supplierId')}
              className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Supplier</option>
              {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
        {!(form.mode === 'credit' || form.mode === 'advance' || form.mode === 'supplier' || form.extraLines.some((l) => l.mode === 'credit' || l.mode === 'advance' || l.mode === 'supplier')) && (
          <div className="col-span-2" />
        )}
      </div>

      {/* Extra Payment Lines - e.g. part paid from the customer's Advance and
          the rest in Mpesa, or Mpesa paid in several separate amounts. Only
          one Advance/Credit/Supplier line is allowed (a sale only has one
          customer/supplier to draw it from) - real-money lines can repeat. */}
      <div className="space-y-1.5 border border-slate-200 rounded p-2">
        <p className="text-xs font-medium text-slate-600">Extra payment lines (optional)</p>
        {form.extraLines.map((line, idx) => (
          <div key={idx} className="flex gap-1.5 items-center">
            <select
              value={line.mode}
              onChange={(e) => updateExtraLine(idx, 'mode', e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="cash">Cash</option>
              <option value="mpesa">Mpesa</option>
              <option value="paybill">Paybill</option>
              <option value="advance">Use customer's advance</option>
              <option value="credit">Add to customer's credit (owed)</option>
              <option value="supplier">Bill to supplier</option>
            </select>
            <input
              type="number"
              value={line.amount}
              onChange={(e) => updateExtraLine(idx, 'amount', e.target.value)}
              placeholder="Amount"
              className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <button type="button" onClick={() => removeExtraLine(idx)} className="p-1.5 text-slate-400 hover:text-red-600 shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
        <button type="button" onClick={addExtraLine} className="text-xs text-emerald-700 hover:text-emerald-800 font-medium">
          + Add another payment line
        </button>
      </div>

      {/* Inline quick-add customer */}
      {form.mode !== 'supplier' && showQuickAddCustomer && quickCustomer && setQuickCustomer && onQuickAddCustomer && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
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
            <button type="button" onClick={onQuickAddSupplier} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">
              Add
            </button>
            <button type="button" onClick={() => setShowQuickAddSupplier && setShowQuickAddSupplier(false)} className="text-slate-500 hover:text-slate-700 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Optional: pay one or more suppliers back for this item's cost price
          right away - the cost can be split across several suppliers, and
          whatever's left over is understood as stock the shop already owned. */}
      {onQuickAddCostSupplier && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.payCostToSupplier}
              onChange={(e) => setForm((prev) => ({
                ...prev,
                payCostToSupplier: e.target.checked,
                costSuppliers: e.target.checked && prev.costSuppliers.length === 0
                  ? [{ supplierId: '', amount: prev.costPrice, mode: 'cash', settlement: emptySettlementAmounts }]
                  : prev.costSuppliers,
              }))}
              onKeyDown={(e) => handleKeyDown(e, 'payCostToSupplier')}
            />
            Pay cost price to a supplier now
          </label>
          {form.payCostToSupplier && (
            <div className="space-y-2">
              {form.costSuppliers.map((cs, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="col-span-2 flex gap-1">
                      <select
                        value={cs.supplierId}
                        onChange={(e) => updateCostSupplier(idx, 'supplierId', e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, 'costSuppliers')}
                        className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      >
                        <option value="">Supplier</option>
                        {sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setCostSupplierQuickAddIndex && setCostSupplierQuickAddIndex(costSupplierQuickAddIndex === idx ? null : idx)}
                        className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                        title="Add new supplier"
                      >
                        <UserPlus size={16} className="text-slate-500" />
                      </button>
                    </div>
                    <input
                      type="number"
                      value={cs.amount}
                      onChange={(e) => updateCostSupplier(idx, 'amount', e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, 'costSuppliers')}
                      placeholder="Amount"
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    <select
                      value={cs.mode}
                      onChange={(e) => updateCostSupplier(idx, 'mode', e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, 'costSuppliers')}
                      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="cash">Cash</option>
                      <option value="mpesa">Mpesa</option>
                      <option value="paybill">Paybill</option>
                    </select>
                    {form.costSuppliers.length > 1 ? (
                      <button type="button" onClick={() => removeCostSupplierRow(idx)} className="text-red-500 hover:text-red-700 text-xs">
                        Remove
                      </button>
                    ) : <div />}
                  </div>
                  {cs.supplierId && suppliers.find((s) => s.id === cs.supplierId)?.linked_partner_id && (
                    <SettlementModeFields
                      partnerLabel={suppliers.find((s) => s.id === cs.supplierId)?.linked_partner_id === 'abdulqadir' ? 'Abdulqadir' : 'Taher'}
                      crossLabel="Mohamedi's Customer Balance"
                      available={computeSettlementAvailable(
                        allTransactions,
                        shareRules,
                        historicalProfit,
                        suppliers.find((s) => s.id === cs.supplierId)!.linked_partner_id!,
                        customers.find((c) => c.linked_partner_id === suppliers.find((s) => s.id === cs.supplierId)?.linked_partner_id)?.credit_balance || 0
                      )}
                      amounts={cs.settlement}
                      onChange={(next) => updateCostSupplierSettlement(idx, next)}
                    />
                  )}
                  {costSupplierQuickAddIndex === idx && quickCostSupplier && setQuickCostSupplier && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
                      <input
                        type="text"
                        value={quickCostSupplier.name}
                        onChange={(e) => setQuickCostSupplier({ ...quickCostSupplier, name: e.target.value })}
                        placeholder="New supplier name"
                        className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                      <input
                        type="text"
                        value={quickCostSupplier.phone}
                        onChange={(e) => setQuickCostSupplier({ ...quickCostSupplier, phone: e.target.value })}
                        placeholder="Phone (optional)"
                        className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                      <div />
                      <div className="flex gap-1">
                        <button type="button" onClick={() => onQuickAddCostSupplier(idx)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">
                          Add
                        </button>
                        <button type="button" onClick={() => setCostSupplierQuickAddIndex && setCostSupplierQuickAddIndex(null)} className="text-slate-500 hover:text-slate-700 text-xs">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addCostSupplierRow}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded flex items-center gap-1"
              >
                <Plus size={12} /> Add Supplier
              </button>
              <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                <span>Cost Price: KES {(parseFloat(form.costPrice || '0')).toLocaleString()}</span>
                <span>Assigned to suppliers: KES {form.costSuppliers.reduce((s, c) => s + (parseFloat(c.amount || '0') || 0), 0).toLocaleString()}</span>
                <span className={(parseFloat(form.costPrice || '0') - form.costSuppliers.reduce((s, c) => s + (parseFloat(c.amount || '0') || 0), 0)) < 0 ? 'text-red-600 font-medium' : ''}>
                  From my shop: KES {(parseFloat(form.costPrice || '0') - form.costSuppliers.reduce((s, c) => s + (parseFloat(c.amount || '0') || 0), 0)).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row 2: SP, CP, Profit, Commission - any 2 of SP/CP/Profit auto-fill the 3rd */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <input
          type="number"
          value={form.sellingPrice}
          onChange={(e) => handleSPChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'sellingPrice')}
          placeholder="SP (Selling Price)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <input
          type="number"
          value={form.costPrice}
          onChange={(e) => handleCPChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'costPrice')}
          placeholder="CP (Cost Price)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <input
          type="number"
          value={form.profit}
          onChange={(e) => handleProfitChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'profit')}
          placeholder="Profit (auto)"
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
          onKeyDown={(e) => handleKeyDown(e, 'commissionMode')}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="cash">From Cash</option>
          <option value="mpesa">From Mpesa</option>
          <option value="paybill">From Paybill</option>
        </select>
      </div>
      <p className="text-xs text-slate-500">Commission is recorded as its own Expense - it does not change this sale's profit.</p>

      {/* Split amounts if split mode */}
      {form.mode === 'split' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="number"
            value={form.splitMpesa}
            onChange={(e) => handleSplitChange('splitMpesa', e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, 'splitMpesa')}
            placeholder="Mpesa"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="number"
            value={form.splitCash}
            onChange={(e) => handleSplitChange('splitCash', e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, 'splitCash')}
            placeholder="Cash"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <input
            type="number"
            value={form.splitPaybill}
            onChange={(e) => handleSplitChange('splitPaybill', e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, 'splitPaybill')}
            placeholder="Paybill"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
      )}

      {/* Advance mode buttons */}
      {(form.mode === 'advance' || form.extraLines.some((l) => l.mode === 'advance')) && (
        <div className="space-y-1">
          {form.mode !== 'advance' && <p className="text-xs text-slate-500">His advance was originally held as:</p>}
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

      {/* Customer paid more than this sale's Selling Price - banks the rest
          as advance for next time (a one-off "Deposit Advance" bolted onto
          this form). Only offered when creating a brand new sale - not on
          Edit or Bulk, so re-saving never fires it twice. */}
      {!hideActions && !isEditing && (
        <div className="space-y-1.5 border border-slate-200 rounded p-2">
          <p className="text-xs font-medium text-slate-600">Customer paid extra? Add it to their advance (optional)</p>
          <div className="flex gap-1.5 items-center flex-wrap">
            <select
              value={form.overpayCustomerId || form.customerId}
              onChange={(e) => update('overpayCustomerId', e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Customer</option>
              {sortCustomersByBalance(customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              type="number"
              value={form.overpayAmount}
              onChange={(e) => update('overpayAmount', e.target.value)}
              placeholder="Extra amount"
              className="w-28 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            {['cash', 'mpesa', 'paybill'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update('overpayMode', m)}
                className={`px-3 py-1 rounded text-xs font-medium ${
                  form.overpayMode === m ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Set a collection reminder for this customer - same idea already on
          the Suppliers Invoice form. Only shown when a customer is actually
          involved (Credit/Advance mode, or an extra Credit/Advance line),
          and only when creating - not Edit or Bulk. */}
      {!hideActions && !isEditing && (form.mode === 'credit' || form.mode === 'advance' || form.extraLines.some((l) => l.mode === 'credit' || l.mode === 'advance')) && (
        <div className="space-y-1.5 border border-slate-200 rounded p-2">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={form.setReminder}
              onChange={(e) => update('setReminder', e.target.checked)}
            />
            Set a reminder to collect from this customer
          </label>
          {form.setReminder && (
            <div className="flex gap-1.5">
              <input
                type="date"
                value={form.reminderDate}
                onChange={(e) => update('reminderDate', e.target.value)}
                className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <input
                type="time"
                value={form.reminderTime}
                onChange={(e) => update('reminderTime', e.target.value)}
                className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* Profit display and actions */}
      {!hideActions && (
        <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
          <button
            onClick={onSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            {saving ? 'Saving...' : (saveLabel || 'Save')}
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
