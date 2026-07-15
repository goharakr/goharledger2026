import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  AlertTriangle,
  Wallet,
  ShoppingCart,
  Users,
  Phone,
  Landmark,
  Receipt,
  Home,
  Bell,
  CheckCircle,
  X,
  Plus,
  Calendar,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, saleProfit } from '../utils/format';
import { useDataRefresh } from '../context/DataContext';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import { fetchAllRows } from '../utils/fetchAll';
import { computeWalletBalance, tomorrowStr } from '../utils/walletBalance';
import { buildMonthlyFigures, calculateShareEarned, getDoubleCountedMonths, calculateHomeExpensesOwed } from '../utils/shareDue';
import type { Transaction, Supplier, Customer, Reminder, LoanTracker, CapitalEntry } from '../types';

interface DailySalesBreakdown {
  totalSales: number;
  cashAmount: number;
  mpesaAmount: number;
  paybillAmount: number;
  creditAmount: number;
  advanceAmount: number;
  supplierAmount: number;
  profit: number;
  commission: number;
  totalExpenses: number;
  cashExpenses: number;
  mpesaExpenses: number;
  paybillExpenses: number;
}

interface MonthlyCapital {
  total: number;
  entries: CapitalEntry[];
}

export default function Dashboard() {
  const { refreshKey } = useDataRefresh();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [monthlyBalances, setMonthlyBalances] = useState<{ id: string; month: string; mpesa: number; cash: number; paybill: number }[]>([]);
  const [computedForwardedBalance, setComputedForwardedBalance] = useState({ mpesa: 0, cash: 0, bank: 0 });
  const [showForwardedBalance, setShowForwardedBalance] = useState(false);
  const [forwardedBalanceForm, setForwardedBalanceForm] = useState({ mpesa: '', cash: '', paybill: '' });
  const [physicalCounts, setPhysicalCounts] = useState<{ id: string; month: string; mpesa_actual: number; cash_actual: number; paybill_actual: number; mpesa_system: number; cash_system: number; paybill_system: number }[]>([]);
  const [showPhysicalCount, setShowPhysicalCount] = useState(false);
  const [physicalCountForm, setPhysicalCountForm] = useState({ mpesa: '', cash: '', paybill: '' });
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);
  const [editingReminder, setEditingReminder] = useState<string | null>(null);
  const [reminderForm, setReminderForm] = useState({
    entityType: 'supplier' as 'supplier' | 'customer',
    entityId: '',
    amount: '',
    dueDate: '',
    reminderDate: '',
    reminderTime: '09:00',
    notes: '',
  });

  // Daily sales with date filter
  const [dailySalesPreset, setDailySalesPreset] = useState<DatePreset>('today');
  const [dailySalesCustomFrom, setDailySalesCustomFrom] = useState('');
  const [dailySalesCustomTo, setDailySalesCustomTo] = useState('');
  const { from: dailySalesFrom, to: dailySalesTo } = getDatePresetRange(dailySalesPreset, dailySalesCustomFrom, dailySalesCustomTo);
  const [dailySalesBreakdown, setDailySalesBreakdown] = useState<DailySalesBreakdown | null>(null);

  // Monthly capital filter
  const [capitalPreset, setCapitalPreset] = useState<DatePreset>('month');
  const [capitalCustomFrom, setCapitalCustomFrom] = useState('');
  const [capitalCustomTo, setCapitalCustomTo] = useState('');
  const { from: capitalFrom, to: capitalTo } = getDatePresetRange(capitalPreset, capitalCustomFrom, capitalCustomTo);
  const [monthlyCapital, setMonthlyCapital] = useState<MonthlyCapital | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, [monthFilter, refreshKey]);

  useEffect(() => {
    if (!stats) return;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const alreadyCounted = physicalCounts.some((c) => c.month === thisMonth);
    if (alreadyCounted) return;
    const skipDate = localStorage.getItem('physicalCountSkipDate');
    const today = new Date().toISOString().split('T')[0];
    if (skipDate === today) return;
    setPhysicalCountForm({ mpesa: '', cash: '', paybill: '' });
    setShowPhysicalCount(true);
  }, [stats, physicalCounts]);

  useEffect(() => {
    if (dailySalesFrom && dailySalesTo) {
      calculateDailySalesBreakdown();
    }
  }, [dailySalesFrom, dailySalesTo, refreshKey]);

  useEffect(() => {
    if (capitalFrom && capitalTo) {
      calculateMonthlyCapital();
    }
  }, [capitalFrom, capitalTo, refreshKey]);

  async function calculateDailySalesBreakdown() {
    const { data: txns } = await supabase
      .from('transactions')
      .select('*')
      .eq('is_void', false)
      .eq('type', 'sale')
      .gte('date', dailySalesFrom)
      .lte('date', dailySalesTo);

    // Get all transactions for expense calculation
    const { data: allTxns } = await supabase
      .from('transactions')
      .select('*')
      .eq('is_void', false)
      .gte('date', dailySalesFrom)
      .lte('date', dailySalesTo);

    const { data: splits } = await supabase.from('transaction_splits').select('*');
    const splitMap = new Map<string, { mode: string; amount: number }[]>();
    splits?.forEach((s) => {
      if (!splitMap.has(s.transaction_id)) splitMap.set(s.transaction_id, []);
      splitMap.get(s.transaction_id)!.push(s);
    });

    let totalSales = 0, cashAmount = 0, mpesaAmount = 0, paybillAmount = 0, creditAmount = 0, advanceAmount = 0, supplierAmount = 0, profit = 0, commission = 0;
    let totalExpenses = 0, cashExpenses = 0, mpesaExpenses = 0, paybillExpenses = 0;

    txns?.forEach((t) => {
      totalSales += t.selling_price || 0;
      profit += saleProfit(t);
      commission += t.commission || 0;

      if (t.primary_mode === 'advance') {
        advanceAmount += t.selling_price || 0;
      } else if (t.primary_mode === 'cash') cashAmount += t.selling_price || 0;
      else if (t.primary_mode === 'mpesa') mpesaAmount += t.selling_price || 0;
      else if (t.primary_mode === 'paybill') paybillAmount += t.selling_price || 0;
      else if (t.primary_mode === 'credit') creditAmount += t.selling_price || 0;
      else if (t.primary_mode === 'supplier') supplierAmount += t.selling_price || 0;
      else if (t.primary_mode === 'split') {
        const s = splitMap.get(t.transaction_id) || [];
        s.forEach((sp) => {
          if (sp.mode === 'cash') cashAmount += sp.amount;
          else if (sp.mode === 'mpesa') mpesaAmount += sp.amount;
          else if (sp.mode === 'paybill') paybillAmount += sp.amount;
        });
      }

      // Commission is a separate cash outflow from whichever mode it's paid from,
      // independent of how the sale itself was settled - deduct it from that
      // mode's bucket so this breakdown matches the main Cash-in-Hand balance.
      if (t.commission && t.commission > 0 && t.commission_mode) {
        if (t.commission_mode === 'cash') cashAmount -= t.commission;
        else if (t.commission_mode === 'mpesa') mpesaAmount -= t.commission;
        else if (t.commission_mode === 'paybill') paybillAmount -= t.commission;
      }
    });

    // Calculate expenses by mode (NOT including supplier invoices/payments)
    const todayStr = new Date().toISOString().split('T')[0];
    allTxns?.forEach((t) => {
      const isPendingClear = t.clears_on && t.clears_on > todayStr;
      // Supplier invoices/payments aren't shop expenses, and a home expense
      // paid "From Own Pocket" isn't real shop cash moving - only its later
      // "From Shop" repayment is, so counting both would double it.
      const isHomeExpenseFromOwnPocket = t.category === 'home_expense' && t.notes?.includes('From Own Pocket');
      if (t.type === 'expense' && t.category !== 'stock' && t.category !== 'supplier_payment' && !isHomeExpenseFromOwnPocket) {
        totalExpenses += t.amount || 0;
        if (!isPendingClear) {
          if (t.primary_mode === 'cash') cashExpenses += t.amount || 0;
          else if (t.primary_mode === 'mpesa') mpesaExpenses += t.amount || 0;
          else if (t.primary_mode === 'paybill') paybillExpenses += t.amount || 0;
        }
      }
      if (t.type === 'partner_draw' || t.type === 'loan_payment') {
        totalExpenses += t.amount || 0;
        if (t.primary_mode === 'cash') cashExpenses += t.amount || 0;
        else if (t.primary_mode === 'mpesa') mpesaExpenses += t.amount || 0;
        else if (t.primary_mode === 'paybill') paybillExpenses += t.amount || 0;
      }
    });

    setDailySalesBreakdown({ totalSales, cashAmount, mpesaAmount, paybillAmount, creditAmount, advanceAmount, supplierAmount, profit, commission, totalExpenses, cashExpenses, mpesaExpenses, paybillExpenses });
  }

  async function calculateMonthlyCapital() {
    const { data: capitalData } = await supabase
      .from('capital_entries')
      .select('*')
      .gte('date', capitalFrom)
      .lte('date', capitalTo)
      .order('date', { ascending: false });

    const total = (capitalData || []).reduce((sum, c) => sum + (c.amount || 0), 0);
    setMonthlyCapital({ total, entries: capitalData || [] });
  }

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const monthStart = monthFilter + '-01';
      const today = new Date().toISOString().split('T')[0];
      const [monthFilterYear, monthFilterMonth] = monthFilter.split('-').map(Number);
      const isLeapYear = (monthFilterYear % 4 === 0 && monthFilterYear % 100 !== 0) || monthFilterYear % 400 === 0;
      const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthFilterMonth - 1];
      const monthEnd = `${monthFilterYear}-${String(monthFilterMonth).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

      const [{ data: txns }, { data: splits }, { data: suppData }, { data: custData }, { data: loans }, { data: reminderData }, { data: capitalData }, { data: histProfit }, { data: shareRules }, { data: monthlyBalancesData }, { data: physicalCountsData }] = await Promise.all([
        fetchAllRows<Transaction>((from, to) =>
          supabase.from('transactions').select('*').eq('is_void', false).range(from, to)
        ),
        supabase.from('transaction_splits').select('*'),
        supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('loan_trackers').select('*'),
        supabase.from('reminders').select('*').eq('status', 'pending').order('reminder_date', { ascending: true }),
        supabase.from('capital_entries').select('*'),
        supabase.from('historical_profit').select('*'),
        supabase.from('share_rules').select('*').eq('is_active', true),
        supabase.from('monthly_balances').select('*'),
        supabase.from('physical_cash_counts').select('*'),
      ]);

      setSuppliers(suppData || []);
      setCustomers(custData || []);
      setReminders(reminderData || []);
      setMonthlyBalances(monthlyBalancesData || []);
      setPhysicalCounts(physicalCountsData || []);

      const idrisLoan = loans?.find((l) => l.loan_name.toLowerCase().includes('idris'));
      const activeLoansList = (loans || []).filter((l) => l.status === 'active');

      let todaySales = 0, todayProfit = 0;
      let monthSales = 0, monthProfit = 0, monthGrossProfit = 0;
      let monthShopExpenses = 0, monthHomeExpenses = 0, monthPartnerDraws = 0, monthLoanPayments = 0;
      let monthSupplierPayments = 0, monthCustomerCollections = 0;
      let totalSales = 0, totalProfit = 0, totalGrossProfit = 0;
      let totalShopExpenses = 0, totalHomeExpenses = 0, totalPartnerDraws = 0, totalLoanPayments = 0;
      let totalSupplierPayments = 0, totalCustomerCollections = 0;

      const splitMap = new Map<string, { mode: string; amount: number }[]>();
      splits?.forEach((s) => {
        if (!splitMap.has(s.transaction_id)) splitMap.set(s.transaction_id, []);
        splitMap.get(s.transaction_id)!.push(s);
      });

      const { mpesa, cash, bank, mpesaAdvance, cashAdvance, bankAdvance } = computeWalletBalance(txns, splitMap, tomorrowStr());
      setComputedForwardedBalance(computeWalletBalance(txns, splitMap, monthStart));

      txns?.forEach((t) => {
        if (t.is_void) return;
        const profitVal = saleProfit(t);
        const isMonth = t.date >= monthStart && t.date <= monthEnd;

        if (t.type === 'sale') {
          totalSales += t.selling_price || 0;
          totalGrossProfit += profitVal;
          if (t.date === today) {
            todaySales += t.selling_price || 0;
            todayProfit += profitVal;
          }
          if (isMonth) {
            monthSales += t.selling_price || 0;
            monthProfit += profitVal;
            monthGrossProfit += profitVal;
          }
          // Track sales to supplier as supplier payments
          if (t.primary_mode === 'supplier' && t.supplier_id) {
            totalSupplierPayments += t.selling_price || 0;
            if (isMonth) monthSupplierPayments += t.selling_price || 0;
          }
          // Track credit sales for customer collections
          if (t.primary_mode === 'credit' && t.customer_id) {
            // Credit sales increase the amount to be collected
          }
        }

        if (t.type === 'expense') {
          // Supplier invoices are NOT shop expenses
          const isSupplierPayment = t.category === 'supplier_payment' || t.category === 'stock';
          if (!isSupplierPayment) {
            if (t.category === 'home_expense') {
              // Only the shop's own reimbursement ("From Shop") is a real shop
              // expense - the original "From Own Pocket" entry is the partner's
              // own money, counted once (here) instead of twice (also here).
              if (t.notes?.includes('From Shop')) {
                totalHomeExpenses += t.amount;
                if (isMonth) monthHomeExpenses += t.amount;
              }
            } else {
              totalShopExpenses += t.amount;
              if (isMonth) monthShopExpenses += t.amount;
            }
          }
        }

        if (t.type === 'partner_draw') {
          totalPartnerDraws += t.amount;
          if (isMonth) monthPartnerDraws += t.amount;
        }

        if (t.type === 'loan_payment') {
          totalLoanPayments += t.amount;
          if (isMonth) monthLoanPayments += t.amount;
        }

        if (t.type === 'supplier_payment') {
          totalSupplierPayments += t.amount;
          if (isMonth) monthSupplierPayments += t.amount;
        }

        if (t.type === 'customer_payment') {
          totalCustomerCollections += t.amount;
          if (isMonth) monthCustomerCollections += t.amount;
        }
      });

      // Partner balances
      let taherBal = 0, abdulBal = 0;
      txns?.forEach((t) => {
        if (t.is_void) return;
        if (t.type === 'partner_draw') {
          if (t.partner_id === 'taher') taherBal -= t.amount;
          if (t.partner_id === 'abdulqadir') abdulBal -= t.amount;
        }
        if (t.type === 'partner_loan') {
          if (t.partner_id === 'taher') taherBal += t.amount;
          if (t.partner_id === 'abdulqadir') abdulBal += t.amount;
        }
      });

      histProfit?.forEach((h) => {
        taherBal += (h.taher_share || 0) - (h.taher_taken || 0);
        abdulBal += (h.abdulqadir_share || 0) - (h.abdulqadir_taken || 0);
      });

      txns?.forEach((t) => {
        if (t.is_void) return;
        if (t.type === 'expense' && t.category === 'home_expense') {
          if (t.notes?.includes('From Own Pocket')) {
            if (t.partner_id === 'taher') taherBal += t.amount;
            if (t.partner_id === 'abdulqadir') abdulBal += t.amount;
          }
          // Reverse the IOU once the shop pays the partner back (mirrors
          // Partners.tsx's calculatePartnerBalance so the two pages agree)
          if (t.notes?.includes('From Shop') && t.notes?.includes('repaying')) {
            if (t.partner_id === 'taher') taherBal -= t.amount;
            if (t.partner_id === 'abdulqadir') abdulBal -= t.amount;
          }
        }
      });

      // Partner cards on this page show 3 separate figures per partner instead of
      // one lumped balance: (1) profit share still due - accumulates every month
      // (using the Fixed/Percentage rule from Profit & Loss) until marked taken,
      // regardless of which month it was earned in, (2) home expenses paid from
      // their own pocket that the shop still owes back, (3) how much they've
      // drawn out in the currently-viewed month only.
      const monthly = buildMonthlyFigures(txns);
      const taherRule = shareRules?.find((r) => r.partner_id === 'taher');
      const abdulRule = shareRules?.find((r) => r.partner_id === 'abdulqadir');
      const taherShareEarned = calculateShareEarned(monthly, taherRule);
      const abdulShareEarned = calculateShareEarned(monthly, abdulRule);

      let taherDrawsAllTime = 0, abdulDrawsAllTime = 0;
      let taherDrawsThisMonth = 0, abdulDrawsThisMonth = 0;
      txns?.forEach((t) => {
        if (t.is_void || t.type !== 'partner_draw') return;
        const isMonth = t.date >= monthStart && t.date <= monthEnd;
        if (t.partner_id === 'taher') { taherDrawsAllTime += t.amount; if (isMonth) taherDrawsThisMonth += t.amount; }
        if (t.partner_id === 'abdulqadir') { abdulDrawsAllTime += t.amount; if (isMonth) abdulDrawsThisMonth += t.amount; }
      });
      const taherHomeOwed = calculateHomeExpensesOwed(txns, 'taher');
      const abdulHomeOwed = calculateHomeExpensesOwed(txns, 'abdulqadir');

      const histTaherRemaining = (histProfit || []).reduce((s, h) => s + (h.taher_share || 0) - (h.taher_taken || 0), 0);
      const histAbdulRemaining = (histProfit || []).reduce((s, h) => s + (h.abdulqadir_share || 0) - (h.abdulqadir_taken || 0), 0);

      const doubleCountedMonths = getDoubleCountedMonths(monthly, (histProfit || []).map((h) => h.month));

      const taherShareDue = taherShareEarned + histTaherRemaining - taherDrawsAllTime;
      const abdulShareDue = abdulShareEarned + histAbdulRemaining - abdulDrawsAllTime;

      const totalSuppliersOwed = (suppData || []).reduce((sum, s) => sum + (s.balance || 0), 0);
      const totalCustomersPending = (custData || []).reduce((sum, c) => sum + (c.credit_balance || 0), 0);
      const totalNetProfit = totalGrossProfit - totalShopExpenses - totalHomeExpenses - totalLoanPayments;
      const monthNetProfit = monthGrossProfit - monthShopExpenses - monthHomeExpenses - monthLoanPayments;
      const totalCapitalVal = (capitalData || []).reduce((sum, c) => sum + (c.amount || 0), 0);

      setStats({
        mpesaBalance: mpesa,
        cashBalance: cash,
        bankBalance: bank,
        mpesaAdvance,
        cashAdvance,
        bankAdvance,
        todaySales,
        todayProfit,
        monthSales,
        monthProfit,
        monthGrossProfit,
        monthNetProfit,
        monthShopExpenses,
        monthHomeExpenses,
        monthPartnerDraws,
        monthLoanPayments,
        monthSupplierPayments,
        monthCustomerCollections,
        totalSuppliersOwed,
        totalCustomersPending,
        taherBalance: taherBal,
        abdulqadirBalance: abdulBal,
        taherShareDue,
        abdulqadirShareDue: abdulShareDue,
        taherHomeOwed,
        abdulqadirHomeOwed: abdulHomeOwed,
        taherDrawsThisMonth,
        abdulqadirDrawsThisMonth: abdulDrawsThisMonth,
        totalSalesSinceStart: totalSales,
        totalProfitSinceStart: totalProfit,
        idrisRemaining: idrisLoan?.remaining_balance || 0,
        idrisLoanId: idrisLoan?.id || null,
        totalShopExpenses,
        totalHomeExpenses,
        totalPartnerDraws,
        totalLoanPayments,
        totalSupplierPayments,
        totalCustomerCollections,
        totalGrossProfit,
        totalNetProfit,
        totalCapital: totalCapitalVal,
        activeLoans: activeLoansList,
        doubleCountedMonths,
      });

    } catch (err) {
      console.error('Dashboard error:', err);
    }
    setLoading(false);
  }

  async function handleAddReminder() {
    if (!reminderForm.entityId || !reminderForm.dueDate || !reminderForm.reminderDate) return;

    await supabase.from('reminders').insert({
      reminder_type: reminderForm.entityType === 'supplier' ? 'supplier_payment' : 'customer_collection',
      entity_id: reminderForm.entityId,
      entity_type: reminderForm.entityType,
      amount: parseFloat(reminderForm.amount || '0') || null,
      due_date: reminderForm.dueDate,
      reminder_date: reminderForm.reminderDate,
      notes: reminderForm.notes || null,
    });

    setReminderForm({ entityType: 'supplier', entityId: '', amount: '', dueDate: '', reminderDate: '', reminderTime: '09:00', notes: '' });
    setShowReminderModal(false);
    fetchDashboardData();
  }

  async function handleDismissReminder(id: string) {
    await supabase.from('reminders').update({ status: 'dismissed' }).eq('id', id);
    fetchDashboardData();
  }

  async function handleCompleteReminder(id: string) {
    await supabase.from('reminders').update({ status: 'completed' }).eq('id', id);
    fetchDashboardData();
  }

  async function handleDeleteReminder(id: string) {
    await supabase.from('reminders').delete().eq('id', id);
    fetchDashboardData();
  }

  async function handleUpdateReminder(id: string) {
    await supabase.from('reminders').update({
      amount: parseFloat(reminderForm.amount || '0') || null,
      notes: reminderForm.notes || null,
    }).eq('id', id);
    setEditingReminder(null);
    fetchDashboardData();
  }

  async function handleSaveForwardedBalance() {
    const { error } = await supabase.from('monthly_balances').upsert({
      month: monthFilter,
      mpesa: parseFloat(forwardedBalanceForm.mpesa || '0'),
      cash: parseFloat(forwardedBalanceForm.cash || '0'),
      paybill: parseFloat(forwardedBalanceForm.paybill || '0'),
    }, { onConflict: 'month' });
    if (error) { alert('Failed to save: ' + error.message); return; }
    setShowForwardedBalance(false);
    fetchDashboardData();
  }

  function todayMonthStr() {
    return new Date().toISOString().slice(0, 7);
  }

  async function handleSavePhysicalCount() {
    const month = todayMonthStr();
    const { error } = await supabase.from('physical_cash_counts').upsert({
      month,
      mpesa_actual: parseFloat(physicalCountForm.mpesa || '0'),
      cash_actual: parseFloat(physicalCountForm.cash || '0'),
      paybill_actual: parseFloat(physicalCountForm.paybill || '0'),
      mpesa_system: stats?.mpesaBalance || 0,
      cash_system: stats?.cashBalance || 0,
      paybill_system: stats?.bankBalance || 0,
      counted_at: new Date().toISOString(),
    }, { onConflict: 'month' });
    if (error) { alert('Failed to save: ' + error.message); return; }
    setShowPhysicalCount(false);
    localStorage.removeItem('physicalCountSkipDate');
    fetchDashboardData();
  }

  function skipPhysicalCountToday() {
    localStorage.setItem('physicalCountSkipDate', new Date().toISOString().split('T')[0]);
    setShowPhysicalCount(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  // Build alerts
  const alerts: { type: 'red' | 'orange' | 'yellow' | 'blue'; message: string; link?: string; entityId?: string }[] = [];

  suppliers.forEach((s) => {
    if (s.balance > 0) alerts.push({ type: 'orange', message: `${s.name}: KES ${formatKES(s.balance)} owed`, link: '/suppliers', entityId: s.id });
  });

  customers.forEach((c) => {
    if (c.credit_balance > 0) alerts.push({ type: 'yellow', message: `${c.name}: KES ${formatKES(c.credit_balance)} credit`, link: '/customers', entityId: c.id });
  });

  if (stats) {
    if (stats.taherBalance > 0) alerts.push({ type: 'blue', message: `Taher: KES ${formatKES(stats.taherBalance)} pending`, link: '/partners' });
    if (stats.abdulqadirBalance > 0) alerts.push({ type: 'blue', message: `Abdulqadir: KES ${formatKES(stats.abdulqadirBalance)} pending`, link: '/partners' });
    if (stats.mpesaBalance < 0) alerts.push({ type: 'red', message: `Mpesa balance is negative: KES ${formatKES(stats.mpesaBalance)}`, link: '/cash-bank' });
    if (stats.cashBalance < 0) alerts.push({ type: 'red', message: `Cash balance is negative: KES ${formatKES(stats.cashBalance)}`, link: '/cash-bank' });
    if (stats.bankBalance < 0) alerts.push({ type: 'red', message: `Bank balance is negative: KES ${formatKES(stats.bankBalance)}`, link: '/cash-bank' });
    stats.activeLoans?.forEach((l: LoanTracker) => {
      if (l.remaining_balance > 0) alerts.push({ type: 'orange', message: `${l.loan_name}: KES ${formatKES(l.remaining_balance)} remaining`, link: '/capital' });
    });
  }

  const today = new Date();
  const dueReminders = reminders.filter((r) => new Date(r.reminder_date) <= today);

  return (
    <div className="space-y-6">
      {/* Cash in Hand - TOP */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button onClick={() => navigate('/cash-bank')} className="text-left">
          <CashCard title="Mpesa Balance" amount={stats?.mpesaBalance || 0} advance={stats?.mpesaAdvance || 0} icon={<Phone size={24} />} color="bg-blue-500" clickable />
        </button>
        <button onClick={() => navigate('/cash-bank')} className="text-left">
          <CashCard title="Cash in Hand" amount={stats?.cashBalance || 0} advance={stats?.cashAdvance || 0} icon={<Wallet size={24} />} color="bg-emerald-500" clickable />
        </button>
        <button onClick={() => navigate('/cash-bank')} className="text-left">
          <CashCard title="Bank Balance" amount={stats?.bankBalance || 0} advance={stats?.bankAdvance || 0} icon={<Landmark size={24} />} color="bg-amber-500" clickable />
        </button>
      </div>

      {/* Physical Cash Count reminder - shows until this month's count is filled in */}
      {!physicalCounts.some((c) => c.month === new Date().toISOString().slice(0, 7)) && (
        <button
          onClick={() => { setPhysicalCountForm({ mpesa: '', cash: '', paybill: '' }); setShowPhysicalCount(true); }}
          className="w-full flex items-center justify-between bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-xl px-4 py-3 text-sm transition-colors"
        >
          <span className="text-blue-800 font-medium">Physical Count - not done for this month yet. Tap to add.</span>
          <Edit2 size={14} className="text-blue-600" />
        </button>
      )}

      {/* Supplier Total Owed - MOVED UP */}
      <button onClick={() => navigate('/suppliers')} className="w-full text-left">
        <div className={`rounded-xl border shadow-sm p-5 transition-colors ${
          (stats?.totalSuppliersOwed || 0) < 0 ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : 'bg-red-50 border-red-200 hover:bg-red-100'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle size={24} className={(stats?.totalSuppliersOwed || 0) < 0 ? 'text-emerald-500' : 'text-red-500'} />
              <div>
                <p className={`text-sm ${(stats?.totalSuppliersOwed || 0) < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {(stats?.totalSuppliersOwed || 0) < 0 ? 'Suppliers Owe You (Credit)' : 'Total Owed to Suppliers'}
                </p>
                <p className={`text-2xl font-bold ${(stats?.totalSuppliersOwed || 0) < 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  KES {formatKES(Math.abs(stats?.totalSuppliersOwed || 0))}
                </p>
              </div>
            </div>
            <span className={`text-sm ${(stats?.totalSuppliersOwed || 0) < 0 ? 'text-emerald-600' : 'text-red-600'}`}>Click to view suppliers</span>
          </div>
        </div>
      </button>

      {/* Daily Sales Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
          <h2 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
            <ShoppingCart size={20} className="text-emerald-500" />
            Sales Breakdown
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <DateFilterBar
              preset={dailySalesPreset}
              customFrom={dailySalesCustomFrom}
              customTo={dailySalesCustomTo}
              onChange={(p, from, to) => { setDailySalesPreset(p); setDailySalesCustomFrom(from); setDailySalesCustomTo(to); }}
            />
            <button onClick={() => navigate('/sales')} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">View Sales</button>
          </div>
        </div>
        {dailySalesBreakdown && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-10 gap-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Total Sales</p>
                <p className="text-lg font-bold text-slate-800">KES {formatKES(dailySalesBreakdown.totalSales)}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-blue-600">Mpesa</p>
                <p className="text-lg font-bold text-blue-700">KES {formatKES(dailySalesBreakdown.mpesaAmount)}</p>
                {dailySalesBreakdown.mpesaExpenses > 0 && (
                  <p className="text-xs text-red-500">-{formatKES(dailySalesBreakdown.mpesaExpenses)} out</p>
                )}
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <p className="text-xs text-emerald-600">Cash</p>
                <p className="text-lg font-bold text-emerald-700">KES {formatKES(dailySalesBreakdown.cashAmount)}</p>
                {dailySalesBreakdown.cashExpenses > 0 && (
                  <p className="text-xs text-red-500">-{formatKES(dailySalesBreakdown.cashExpenses)} out</p>
                )}
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-600">Bank/Paybill</p>
                <p className="text-lg font-bold text-amber-700">KES {formatKES(dailySalesBreakdown.paybillAmount)}</p>
                {dailySalesBreakdown.paybillExpenses > 0 && (
                  <p className="text-xs text-red-500">-{formatKES(dailySalesBreakdown.paybillExpenses)} out</p>
                )}
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-xs text-red-600">Credit</p>
                <p className="text-lg font-bold text-red-700">KES {formatKES(dailySalesBreakdown.creditAmount)}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-purple-600">Advance</p>
                <p className="text-lg font-bold text-purple-700">KES {formatKES(dailySalesBreakdown.advanceAmount)}</p>
              </div>
              <div className="bg-slate-100 rounded-lg p-3">
                <p className="text-xs text-slate-600">Supplier</p>
                <p className="text-lg font-bold text-slate-700">KES {formatKES(dailySalesBreakdown.supplierAmount)}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <p className="text-xs text-orange-600">Commission</p>
                <p className="text-lg font-bold text-orange-700">KES {formatKES(dailySalesBreakdown.commission)}</p>
              </div>
              <div className="bg-red-100 rounded-lg p-3">
                <p className="text-xs text-red-600">Total Expenses</p>
                <p className="text-lg font-bold text-red-700">KES {formatKES(dailySalesBreakdown.totalExpenses)}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-green-600">Profit</p>
                <p className="text-lg font-bold text-green-700">KES {formatKES(dailySalesBreakdown.profit)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Monthly Capital Given to Shop */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
          <h2 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
            <TrendingUp size={20} className="text-emerald-500" />
            Capital Injected (from Retained Profit)
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <DateFilterBar
              preset={capitalPreset}
              customFrom={capitalCustomFrom}
              customTo={capitalCustomTo}
              onChange={(p, from, to) => { setCapitalPreset(p); setCapitalCustomFrom(from); setCapitalCustomTo(to); }}
            />
            <button onClick={() => navigate('/capital')} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">View Capital</button>
          </div>
        </div>
        {monthlyCapital && (
          <div className="flex items-center gap-6">
            <div className="bg-emerald-50 rounded-lg p-4 flex-1">
              <p className="text-sm text-emerald-600">Total Capital Injected</p>
              <p className="text-2xl font-bold text-emerald-700">KES {formatKES(monthlyCapital.total)}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-500 mb-2">Recent Entries:</p>
              <div className="space-y-1">
                {monthlyCapital.entries.slice(0, 3).map((e) => (
                  <div key={e.id} className="flex justify-between text-sm">
                    <span className="text-slate-600">{formatDate(e.date)} - {e.partner_id}</span>
                    <span className="font-medium">KES {formatKES(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Monthly Statistics with filter */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
          <h2 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
            <Calendar size={20} className="text-emerald-500" />
            Quick Monthly Statistics
          </h2>
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>

        {/* Forwarded Balance - balance carried in at the start of the selected month.
            Auto-calculated from transactions before the month starts; a saved
            override (if you've corrected it) takes priority over the auto value. */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 rounded-lg px-4 py-3 mb-4">
          {(() => {
            const fb = monthlyBalances.find((m) => m.month === monthFilter);
            const display = fb
              ? { mpesa: fb.mpesa, cash: fb.cash, paybill: fb.paybill }
              : { mpesa: computedForwardedBalance.mpesa, cash: computedForwardedBalance.cash, paybill: computedForwardedBalance.bank };
            return (
              <>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-slate-500">Forwarded Balance:</span>
                  <span>Mpesa <span className="font-medium text-slate-800">KES {formatKES(display.mpesa)}</span></span>
                  <span>Cash <span className="font-medium text-slate-800">KES {formatKES(display.cash)}</span></span>
                  <span>Paybill <span className="font-medium text-slate-800">KES {formatKES(display.paybill)}</span></span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${fb ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                    {fb ? 'Manually set' : 'Auto-calculated'}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setForwardedBalanceForm({
                      mpesa: String(display.mpesa),
                      cash: String(display.cash),
                      paybill: String(display.paybill),
                    });
                    setShowForwardedBalance(true);
                  }}
                  className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1"
                >
                  <Edit2 size={12} /> Edit
                </button>
              </>
            );
          })()}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button onClick={() => navigate('/sales')} className="text-left"><StatBox label="Sales" value={stats?.monthSales || 0} icon={<ShoppingCart size={16} />} clickable /></button>
          <button onClick={() => navigate('/profit-loss')} className="text-left"><StatBox label="Gross Profit" value={stats?.monthGrossProfit || 0} icon={<TrendingUp size={16} />} color="text-emerald-600" clickable /></button>
          <button onClick={() => navigate('/profit-loss')} className="text-left"><StatBox label="Net Profit" value={stats?.monthNetProfit || 0} icon={<TrendingUp size={16} />} color="text-emerald-600" clickable /></button>
          <button onClick={() => navigate('/expenses')} className="text-left"><StatBox label="Shop Expenses" value={stats?.monthShopExpenses || 0} icon={<Receipt size={16} />} color="text-red-600" clickable /></button>
          <button onClick={() => navigate('/expenses')} className="text-left"><StatBox label="Home Expenses" value={stats?.monthHomeExpenses || 0} icon={<Home size={16} />} color="text-orange-600" clickable /></button>
          <button onClick={() => navigate('/partners')} className="text-left"><StatBox label="Partner Withdrawals" value={stats?.monthPartnerDraws || 0} icon={<Users size={16} />} color="text-purple-600" clickable /></button>
          <button onClick={() => navigate('/suppliers')} className="text-left"><StatBox label="Supplier Payments" value={stats?.monthSupplierPayments || 0} icon={<ArrowUp size={16} />} color="text-amber-600" clickable /></button>
          <button onClick={() => navigate('/customers')} className="text-left"><StatBox label="Customers Pending" value={stats?.totalCustomersPending || 0} icon={<ArrowDown size={16} />} color="text-blue-600" clickable /></button>
        </div>
      </div>

      {stats?.doubleCountedMonths?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Check Share Due for {stats.doubleCountedMonths.join(', ')}
            </p>
            <p className="text-sm text-amber-700">
              These month(s) have both a Historical Profit entry (Capital page) and live transactions.
              Both are being counted in Share Due, which may be counting that month's profit twice.
            </p>
          </div>
        </div>
      )}

      {/* Partner Balances */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => navigate('/partners?partner=taher')} className="text-left">
          <PartnerCard
            name="Taher"
            shareDue={stats?.taherShareDue || 0}
            homeOwed={stats?.taherHomeOwed || 0}
            takenThisMonth={stats?.taherDrawsThisMonth || 0}
            clickable
          />
        </button>
        <button onClick={() => navigate('/partners?partner=abdulqadir')} className="text-left">
          <PartnerCard
            name="Abdulqadir"
            shareDue={stats?.abdulqadirShareDue || 0}
            homeOwed={stats?.abdulqadirHomeOwed || 0}
            takenThisMonth={stats?.abdulqadirDrawsThisMonth || 0}
            clickable
          />
        </button>
      </div>

      {/* Active Loans - Clickable */}
      {stats?.activeLoans && stats.activeLoans.length > 0 && (
        <button onClick={() => navigate('/capital')} className="w-full text-left">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:bg-slate-50 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-slate-800">Active Loans</h2>
              <span className="text-sm text-emerald-600">Click to manage</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.activeLoans.map((loan: LoanTracker) => (
                <div key={loan.id} className="bg-slate-50 rounded-lg p-4">
                  <p className="font-medium text-slate-800">{loan.loan_name}</p>
                  <p className="text-sm text-slate-500">Remaining: <span className="font-medium text-red-600">KES {formatKES(loan.remaining_balance)}</span></p>
                  <p className="text-sm text-slate-500">Total: KES {formatKES(loan.total_amount)}</p>
                  <div className="mt-2 w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full"
                      style={{ width: `${Math.min(100, ((loan.total_amount - loan.remaining_balance) / loan.total_amount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </button>
      )}

      {/* Collapsible Alerts Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <button
          onClick={() => setShowAlerts(!showAlerts)}
          className="w-full px-4 py-3 flex items-center gap-2 hover:bg-slate-50 transition-colors"
        >
          {showAlerts ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <Bell size={18} className="text-amber-500" />
          <h2 className="font-semibold text-lg text-slate-800">Alerts & Reminders</h2>
          <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{alerts.length + dueReminders.length}</span>
        </button>

        {showAlerts && (
          <div className="border-t border-slate-100">
            {/* Due Reminders */}
            {dueReminders.length > 0 && (
              <div className="divide-y divide-slate-100">
                {dueReminders.map((r) => {
                  const entity = r.entity_type === 'supplier'
                    ? suppliers.find((s) => s.id === r.entity_id)
                    : customers.find((c) => c.id === r.entity_id);
                  return (
                    <div key={r.id} className="px-4 py-3 flex items-center gap-3 bg-red-50">
                      <Bell size={16} className="text-red-500" />
                      <div className="flex-1">
                        {editingReminder === r.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={reminderForm.amount}
                              onChange={(e) => setReminderForm({ ...reminderForm, amount: e.target.value })}
                              placeholder="Amount"
                              className="border border-slate-300 rounded px-2 py-1 text-sm w-32"
                            />
                            <input
                              type="text"
                              value={reminderForm.notes}
                              onChange={(e) => setReminderForm({ ...reminderForm, notes: e.target.value })}
                              placeholder="Note"
                              className="border border-slate-300 rounded px-2 py-1 text-sm flex-1"
                            />
                            <button onClick={() => handleUpdateReminder(r.id)} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Save</button>
                            <button onClick={() => setEditingReminder(null)} className="text-xs bg-slate-200 px-2 py-1 rounded">Cancel</button>
                          </div>
                        ) : (
                          <>
                            <span className="text-base font-medium text-slate-800">
                              {r.reminder_type === 'supplier_payment' ? 'Pay' : 'Collect from'} {entity?.name || 'Unknown'}
                              {r.amount ? ` - KES ${formatKES(r.amount)}` : ''}
                            </span>
                            <p className="text-sm text-slate-500">Due: {formatDate(r.due_date)} {r.notes && `- ${r.notes}`}</p>
                          </>
                        )}
                      </div>
                      {editingReminder !== r.id && (
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingReminder(r.id); setReminderForm({ ...reminderForm, amount: String(r.amount || ''), notes: r.notes || '' }); }} className="p-1 hover:bg-slate-200 rounded">
                            <Edit2 size={12} className="text-slate-500" />
                          </button>
                          <button onClick={() => handleDeleteReminder(r.id)} className="p-1 hover:bg-red-100 rounded">
                            <Trash2 size={12} className="text-red-500" />
                          </button>
                          <button onClick={() => handleCompleteReminder(r.id)} className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-2 py-1 rounded transition-colors">Done</button>
                          <button onClick={() => handleDismissReminder(r.id)} className="text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 px-2 py-1 rounded transition-colors">Dismiss</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* General Alerts */}
            {alerts.length > 0 && (
              <div className="divide-y divide-slate-100">
                {alerts.map((alert) => (
                  <div key={alert.message} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      alert.type === 'red' ? 'bg-red-500' :
                      alert.type === 'orange' ? 'bg-orange-500' :
                      alert.type === 'yellow' ? 'bg-amber-500' : 'bg-blue-500'
                    }`} />
                    <span className="text-base text-slate-700 flex-1">{alert.message}</span>
                    {alert.link && (
                      <button onClick={() => navigate(alert.link!)} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                        View
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add Reminder Button */}
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => setShowReminderModal(true)}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                <Plus size={14} /> Add Reminder
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Physical Cash Count Modal - pops up automatically until filled in for the month */}
      {showPhysicalCount && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Physical Cash Count - {todayMonthStr()}</h3>
              <button onClick={skipPhysicalCountToday} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Type in what you physically have right now. It's fine if it doesn't match - this is just a record.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mpesa (actual)</label>
                <input
                  type="number"
                  value={physicalCountForm.mpesa}
                  onChange={(e) => setPhysicalCountForm({ ...physicalCountForm, mpesa: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cash (actual)</label>
                <input
                  type="number"
                  value={physicalCountForm.cash}
                  onChange={(e) => setPhysicalCountForm({ ...physicalCountForm, cash: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Paybill / Bank (actual)</label>
                <input
                  type="number"
                  value={physicalCountForm.paybill}
                  onChange={(e) => setPhysicalCountForm({ ...physicalCountForm, paybill: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSavePhysicalCount} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-medium">Save</button>
                <button onClick={skipPhysicalCountToday} className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 rounded-lg text-sm font-medium">Skip for now</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Forwarded Balance Modal */}
      {showForwardedBalance && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Forwarded Balance - {monthFilter}</h3>
              <button onClick={() => setShowForwardedBalance(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Balance carried in at the start of this month.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mpesa</label>
                <input
                  type="number"
                  value={forwardedBalanceForm.mpesa}
                  onChange={(e) => setForwardedBalanceForm({ ...forwardedBalanceForm, mpesa: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cash</label>
                <input
                  type="number"
                  value={forwardedBalanceForm.cash}
                  onChange={(e) => setForwardedBalanceForm({ ...forwardedBalanceForm, cash: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Paybill (Bank)</label>
                <input
                  type="number"
                  value={forwardedBalanceForm.paybill}
                  onChange={(e) => setForwardedBalanceForm({ ...forwardedBalanceForm, paybill: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <button onClick={handleSaveForwardedBalance} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Reminder Modal */}
      {showReminderModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Set Payment Reminder</h3>
              <button onClick={() => setShowReminderModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={reminderForm.entityType} onChange={(e) => setReminderForm({ ...reminderForm, entityType: e.target.value as 'supplier' | 'customer', entityId: '' })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option value="supplier">Pay Supplier</option>
                  <option value="customer">Collect from Customer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{reminderForm.entityType === 'supplier' ? 'Supplier' : 'Customer'}</label>
                <select value={reminderForm.entityId} onChange={(e) => setReminderForm({ ...reminderForm, entityId: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option value="">Select {reminderForm.entityType}</option>
                  {reminderForm.entityType === 'supplier'
                    ? suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                    : customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                  }
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={reminderForm.amount} onChange={(e) => setReminderForm({ ...reminderForm, amount: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label><input type="date" value={reminderForm.dueDate} onChange={(e) => setReminderForm({ ...reminderForm, dueDate: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Reminder Date</label><input type="date" value={reminderForm.reminderDate} onChange={(e) => setReminderForm({ ...reminderForm, reminderDate: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Reminder Time</label><input type="time" value={reminderForm.reminderTime} onChange={(e) => setReminderForm({ ...reminderForm, reminderTime: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={reminderForm.notes} onChange={(e) => setReminderForm({ ...reminderForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <button onClick={handleAddReminder} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm font-medium">Set Reminder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CashCard({ title, amount, advance, icon, color, clickable }: { title: string; amount: number; advance?: number; icon: React.ReactNode; color: string; clickable?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 ${clickable ? 'hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-base font-medium text-slate-500">{title}</span>
        <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center text-white`}>
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-slate-800">KES {formatKES(amount)}</p>
      {advance && advance > 0 && (
        <p className="text-xs text-red-600 mt-1">Includes KES {formatKES(advance)} advance</p>
      )}
    </div>
  );
}

function StatBox({ label, value, icon, color, clickable }: { label: string; value: number; icon?: React.ReactNode; color?: string; clickable?: boolean }) {
  return (
    <div className={`bg-slate-50 rounded-lg p-4 ${clickable ? 'hover:bg-slate-100 transition-colors cursor-pointer' : ''}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className={color || 'text-slate-400'}>{icon}</span>}
        <p className="text-sm text-slate-500">{label}</p>
      </div>
      <p className={`text-xl font-bold ${color || 'text-slate-800'}`}>KES {formatKES(value)}</p>
    </div>
  );
}

function PartnerCard({ name, shareDue, homeOwed, takenThisMonth, clickable }: { name: string; shareDue: number; homeOwed: number; takenThisMonth: number; clickable?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${clickable ? 'hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer' : ''}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <Users size={18} className="text-slate-400" />
        <h3 className="font-semibold text-base text-slate-800">{name}</h3>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Share due</span>
          <span className={`text-sm font-semibold ${shareDue >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            KES {formatKES(Math.abs(shareDue))}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Home expenses owed</span>
          <span className={`text-sm font-semibold ${homeOwed >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            KES {formatKES(Math.abs(homeOwed))}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Taken this month</span>
          <span className="text-sm font-semibold text-slate-700">
            KES {formatKES(takenThisMonth)}
          </span>
        </div>
      </div>
    </div>
  );
}