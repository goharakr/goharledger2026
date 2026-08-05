import { useEffect, useState, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset, DATE_PRESET_OPTIONS } from '../utils/dateFilters';
import {
  TrendingUp,
  TrendingDown,
  X,
  Save,
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
  AlertTriangle,
  Edit2,
  Trash2,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, getMonthLabel, todayStr } from '../utils/format';
import { insertTransactionWithId } from '../utils/transactionId';
import { fetchAllRows } from '../utils/fetchAll';
import { buildMonthlyFigures, getDoubleCountedMonths as getDoubleCountedMonthsShared, calculateHomeExpensesOwed, calculateShareDue as calculateShareDueShared } from '../utils/shareDue';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { usePersistentState } from '../context/PageStateContext';
import { useSaveGuard } from '../utils/useSaveGuard';
import { handleFormKeyNav } from '../utils/formKeyNav';
import LedgerModal from '../components/LedgerModal';
import type { Transaction, HistoricalProfit } from '../types';

interface DrawForm {
  amount: string;
  date: string;
  mode: string;
  notes: string;
}

const emptyDraw: DrawForm = {
  amount: '',
  date: todayStr(),
  mode: 'cash',
  notes: '',
};

export default function Partners() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const partnerParam = searchParams.get('partner');
  const [activePartner, setActivePartner] = usePersistentState<'taher' | 'abdulqadir'>('partners.activePartner', () =>
    partnerParam === 'abdulqadir' || partnerParam === 'taher'
      ? partnerParam
      : user?.username === 'abdulqadir' ? 'abdulqadir' : 'taher'
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [shareRules, setShareRules] = useState<{ partner_id: string; rule_type: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDraw, setShowDraw] = usePersistentState('partners.showDraw', false);
  const [showReturn, setShowReturn] = usePersistentState('partners.showReturn', false);
  const [drawForm, setDrawForm] = usePersistentState<DrawForm>('partners.drawForm', emptyDraw);
  const [returnForm, setReturnForm] = usePersistentState<DrawForm>('partners.returnForm', emptyDraw);
  const [showMarkTaken, setShowMarkTaken] = usePersistentState<{ type: 'profit' | 'expense'; amount: number; id: string } | null>('partners.showMarkTaken', null);
  const [markForm, setMarkForm] = usePersistentState<DrawForm>('partners.markForm', emptyDraw);
  const [showLedger, setShowLedger] = useState(false);
  const [takenPreset, setTakenPreset] = usePersistentState<DatePreset>('partners.takenPreset', 'month');
  const [takenCustomFrom, setTakenCustomFrom] = usePersistentState('partners.takenCustomFrom', '');
  const [takenCustomTo, setTakenCustomTo] = usePersistentState('partners.takenCustomTo', '');
  const [showEditRules, setShowEditRules] = useState(false);
  const [ruleForm, setRuleForm] = useState({ type: 'fixed' as 'fixed' | 'percentage', taherValue: '100000', abdulqadirValue: '100000' });
  const { saving: savingDraw, guard: guardDraw } = useSaveGuard();
  const { saving: savingReturn, guard: guardReturn } = useSaveGuard();
  const { saving: savingMarkTaken, guard: guardMarkTaken } = useSaveGuard();
  const { saving: savingRules, guard: guardRules } = useSaveGuard();
  const [editingTxnId, setEditingTxnId] = usePersistentState<string | null>('partners.editingTxnId', null);
  const [txnEditForm, setTxnEditForm] = usePersistentState('partners.txnEditForm', { date: '', amount: '', mode: 'cash', notes: '' });

  useEffect(() => {
    if (partnerParam === 'abdulqadir' || partnerParam === 'taher') {
      setActivePartner(partnerParam);
    }
  }, [partnerParam]);

  useEffect(() => {
    fetchData();
  }, [activePartner, refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: hist }, { data: rules }] = await Promise.all([
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').order('date', { ascending: false }).range(from, to)
      ),
      supabase.from('historical_profit').select('*').order('month', { ascending: false }),
      supabase.from('share_rules').select('*').eq('is_active', true),
    ]);
    setTransactions(txns || []);
    setHistoricalProfit(hist || []);
    setShareRules(rules || []);

    const taherRule = rules?.find((r) => r.partner_id === 'taher');
    const abdulRule = rules?.find((r) => r.partner_id === 'abdulqadir');
    if (taherRule && abdulRule) {
      setRuleForm({
        type: taherRule.rule_type as 'fixed' | 'percentage',
        taherValue: String(taherRule.value),
        abdulqadirValue: String(abdulRule.value),
      });
    }

    setLoading(false);
  }

  async function handleSaveRules() {
    const now = todayStr();
    await supabase.from('share_rules').update({ is_active: false, effective_to: now }).eq('is_active', true);
    await supabase.from('share_rules').insert([
      { partner_id: 'taher', rule_type: ruleForm.type, value: parseFloat(ruleForm.taherValue), effective_from: now, is_active: true },
      { partner_id: 'abdulqadir', rule_type: ruleForm.type, value: parseFloat(ruleForm.abdulqadirValue), effective_from: now, is_active: true },
    ]);
    setShowEditRules(false);
    fetchData();
    triggerRefresh();
  }

  // Mirrors Dashboard's "Share due" calc: applies the active share rule across
  // every month with transactions, plus any historical carry-over, minus draws.
  function calculateShareDue(partner: string) {
    return calculateShareDueShared(transactions, shareRules, historicalProfit, partner);
  }

  function getDoubleCountedMonths() {
    const monthly = buildMonthlyFigures(transactions);
    return getDoubleCountedMonthsShared(monthly, historicalProfit.map((h) => h.month));
  }

  function calculateHomeOwed(partner: string) {
    return calculateHomeExpensesOwed(transactions, partner);
  }

  function calculateTakenInRange(partner: string, from: string, to: string) {
    return transactions.reduce((s, t) => (
      t.type === 'partner_draw' && t.partner_id === partner && !t.is_void && t.date >= from && t.date <= to ? s + t.amount : s
    ), 0);
  }

  function calculatePartnerBalance(partner: string) {
    let balance = 0;

    // Historical profit shares
    historicalProfit.forEach((h) => {
      const share = partner === 'taher' ? (h.taher_share || 0) : (h.abdulqadir_share || 0);
      const taken = partner === 'taher' ? (h.taher_taken || 0) : (h.abdulqadir_taken || 0);
      balance += share - taken;
    });

    // Partner draws (money taken from shop)
    transactions.forEach((t) => {
      if (t.type === 'partner_draw' && t.partner_id === partner && !t.is_void) {
        balance -= t.amount;
      }
    });

    // Partner loans (money returned to shop)
    transactions.forEach((t) => {
      if (t.type === 'partner_loan' && t.partner_id === partner && !t.is_void) {
        balance += t.amount;
      }
    });

    // Home expenses from own pocket (shop owes partner)
    transactions.forEach((t) => {
      if (t.type === 'expense' && t.category === 'home_expense' && t.partner_id === partner && !t.is_void) {
        if (t.notes?.includes('From Own Pocket')) {
          balance += t.amount;
        }
      }
    });

    // Home expenses marked as taken (shop paid back partner)
    transactions.forEach((t) => {
      if (t.type === 'expense' && t.category === 'home_expense' && t.partner_id === partner && !t.is_void) {
        if (t.notes?.includes('From Shop') && t.notes?.includes('repaying')) {
          balance -= t.amount;
        }
      }
    });

    return balance;
  }

  async function handleDraw() {
    if (!drawForm.amount || parseFloat(drawForm.amount) <= 0) return;

    const amt = parseFloat(drawForm.amount);
    const { data: newTxn, error } = await insertTransactionWithId('DRW-' + drawForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: drawForm.date,
      type: 'partner_draw',
      primary_mode: drawForm.mode,
      amount: amt,
      partner_id: activePartner,
      description: `Partner draw - ${activePartner}`,
      notes: drawForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save draw: ' + (error?.message || 'unknown error')); return; }

    setDrawForm(emptyDraw);
    setShowDraw(false);
    fetchData();
    triggerRefresh();
  }

  async function handleReturn() {
    if (!returnForm.amount || parseFloat(returnForm.amount) <= 0) return;

    const amt = parseFloat(returnForm.amount);
    const { data: newTxn, error } = await insertTransactionWithId('RET-' + returnForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: returnForm.date,
      type: 'partner_loan',
      primary_mode: returnForm.mode,
      amount: amt,
      partner_id: activePartner,
      description: `Partner return - ${activePartner}`,
      notes: returnForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save return: ' + (error?.message || 'unknown error')); return; }

    setReturnForm(emptyDraw);
    setShowReturn(false);
    fetchData();
    triggerRefresh();
  }

  async function handleMarkTaken() {
    if (!showMarkTaken || !markForm.amount || parseFloat(markForm.amount) <= 0) return;

    const amt = parseFloat(markForm.amount);
    const isProfitShare = showMarkTaken.type === 'profit';
    const { data: newTxn, error } = await insertTransactionWithId('TKN-' + markForm.date.replace(/-/g, ''), (txnId) =>
      isProfitShare
        ? {
            transaction_id: txnId,
            date: markForm.date,
            type: 'partner_draw',
            primary_mode: markForm.mode,
            amount: amt,
            partner_id: activePartner,
            description: `Profit share taken - ${activePartner}`,
            notes: markForm.notes || null,
            created_by: user?.username || null,
          }
        : {
            transaction_id: txnId,
            date: markForm.date,
            type: 'expense',
            primary_mode: markForm.mode,
            amount: amt,
            partner_id: activePartner,
            category: 'home_expense',
            description: `Home expense repaid - ${activePartner}`,
            notes: `From Shop | repaying ${showMarkTaken.id}`,
            created_by: user?.username || null,
          }
    );
    if (error || !newTxn) { console.error(error); alert('Failed to save: ' + (error?.message || 'unknown error')); return; }

    // The draw above records the money leaving - this updates the profit
    // share record itself, so Remaining/Status actually reflect it (without
    // this, the row stays "pending" forever and invites clicking it again).
    if (isProfitShare) {
      const histRow = historicalProfit.find((h) => h.month === showMarkTaken.id);
      if (histRow) {
        const field = activePartner === 'taher' ? 'taher_taken' : 'abdulqadir_taken';
        const { error: histError } = await supabase
          .from('historical_profit')
          .update({ [field]: (histRow[field] || 0) + amt })
          .eq('id', histRow.id);
        if (histError) {
          alert('The draw was saved, but updating the profit share record failed: ' + histError.message + '. Please check the Capital page.');
        }
      }
    }

    setShowMarkTaken(null);
    setMarkForm(emptyDraw);
    fetchData();
    triggerRefresh();
  }

  // Draws/Returns have no stored balance to keep in sync - calculatePartnerBalance
  // and calculateShareDue both re-derive everything live from these rows'
  // own amount each time, so editing/voiding here is just updating the row.
  function getPartnerTransactions(from: string, to: string) {
    return transactions
      .filter((t) => (t.type === 'partner_draw' || t.type === 'partner_loan') && t.partner_id === activePartner && !t.is_void && t.date >= from && t.date <= to)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function startEditTxn(t: Transaction) {
    setEditingTxnId(t.id);
    setTxnEditForm({ date: t.date, amount: String(t.amount || ''), mode: t.primary_mode || 'cash', notes: t.notes || '' });
  }

  async function handleUpdateTxn() {
    if (!editingTxnId) return;
    const newAmount = parseFloat(txnEditForm.amount);
    if (!txnEditForm.amount || isNaN(newAmount) || newAmount <= 0) { alert('Enter a valid amount greater than 0'); return; }
    const { error } = await supabase.from('transactions').update({
      date: txnEditForm.date,
      amount: newAmount,
      primary_mode: txnEditForm.mode,
      notes: txnEditForm.notes || null,
      edited_at: new Date().toISOString(),
    }).eq('id', editingTxnId);
    if (error) { alert('Failed to save: ' + error.message); return; }
    setEditingTxnId(null);
    fetchData();
    triggerRefresh();
  }

  async function handleVoidTxn(t: Transaction) {
    if (!confirm('Void this entry?')) return;
    const { error } = await supabase.from('transactions').update({ is_void: true }).eq('id', t.id);
    if (error) { alert('Failed to void: ' + error.message); return; }
    fetchData();
    triggerRefresh();
  }

  const balance = calculatePartnerBalance(activePartner);
  const isPositive = balance >= 0;
  const shareDue = calculateShareDue(activePartner);
  const homeOwed = calculateHomeOwed(activePartner);
  const takenRange = getDatePresetRange(takenPreset, takenCustomFrom, takenCustomTo);
  const takenInRange = calculateTakenInRange(activePartner, takenRange.from, takenRange.to);

  const profitShares = historicalProfit.map((h) => {
    const earned = activePartner === 'taher' ? (h.taher_share || 0) : (h.abdulqadir_share || 0);
    const taken = activePartner === 'taher' ? (h.taher_taken || 0) : (h.abdulqadir_taken || 0);
    const remaining = earned - taken;
    return {
      month: h.month,
      earned,
      taken,
      remaining,
      status: remaining > 0 ? 'pending' : taken > earned ? 'advance' : 'taken',
    };
  });

  const homeExpenses = transactions
    .filter((t) => t.type === 'expense' && t.category === 'home_expense' && t.partner_id === activePartner && !t.is_void && t.notes?.includes('From Own Pocket'))
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description || 'Home expense',
      amount: t.amount,
      createdBy: t.created_by,
      status: transactions.some((tx) => tx.notes?.includes(t.id) && tx.type === 'expense') ? 'taken' : 'pending',
    }));

  const doubleCountedMonths = getDoubleCountedMonths();

  return (
    <div className="space-y-6">
      {loading && <p className="text-xs text-slate-400">Loading...</p>}
      {doubleCountedMonths.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Check Share Due for {doubleCountedMonths.join(', ')}
            </p>
            <p className="text-sm text-amber-700">
              These month(s) have both a Historical Profit entry (Capital page) and live transactions.
              Both are being counted in Share Due, which may be counting that month's profit twice.
            </p>
          </div>
        </div>
      )}

      {/* Partner Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {(['taher', 'abdulqadir'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setActivePartner(p)}
            className={`px-6 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              activePartner === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Hero Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isPositive ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {isPositive ? <TrendingUp size={32} className="text-emerald-600" /> : <TrendingDown size={32} className="text-red-600" />}
          </div>
          <div>
            <p className="text-sm text-slate-500">
              {isPositive ? `Shop Owes ${activePartner.charAt(0).toUpperCase() + activePartner.slice(1)}` : `${activePartner.charAt(0).toUpperCase() + activePartner.slice(1)} Owes Shop`}
            </p>
            <p className={`text-3xl font-bold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              KES {formatKES(Math.abs(balance))}
            </p>
          </div>
        </div>
      </div>

      {/* Summary figures - same numbers shown on the Dashboard card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Share due</p>
            <button onClick={() => setShowEditRules(true)} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Edit Rule</button>
          </div>
          <p className={`text-xl font-bold ${shareDue >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>KES {formatKES(Math.abs(shareDue))}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm text-slate-500">Home expenses owed</p>
          <p className="text-xl font-bold text-blue-600">KES {formatKES(homeOwed)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm text-slate-500">Taken ({DATE_PRESET_OPTIONS.find((o) => o.value === takenPreset)?.label})</p>
          <p className="text-xl font-bold text-slate-800">KES {formatKES(takenInRange)}</p>
        </div>
      </div>

      <DateFilterBar
        preset={takenPreset}
        customFrom={takenCustomFrom}
        customTo={takenCustomTo}
        onChange={(p, from, to) => { setTakenPreset(p); setTakenCustomFrom(from); setTakenCustomTo(to); }}
      />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { setShowDraw(true); setDrawForm({ ...emptyDraw, date: todayStr() }); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <ArrowDownCircle size={16} /> Take Money
        </button>
        <button onClick={() => { setShowReturn(true); setReturnForm({ ...emptyDraw, date: todayStr() }); }} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <ArrowUpCircle size={16} /> Return Money
        </button>
        <button onClick={() => setShowLedger(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Transaction History - full Edit/Void for Draws and Returns, using
          the same date range as the "Taken" figure above */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h4 className="font-semibold text-slate-800 text-sm">Transaction History</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {getPartnerTransactions(takenRange.from, takenRange.to).length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 text-xs">No transactions</td></tr>
              ) : (
                getPartnerTransactions(takenRange.from, takenRange.to).map((t) => (
                  <Fragment key={t.id}>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-slate-600">{formatDate(t.date)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${t.type === 'partner_draw' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {t.type === 'partner_draw' ? 'Draw' : 'Return'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs capitalize">{t.primary_mode || '-'}</td>
                    <td className="px-3 py-2 text-slate-700 text-xs">
                      {t.notes || t.description || '-'}
                      {t.edited_at && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Edited</span>}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${t.type === 'partner_draw' ? 'text-red-600' : 'text-emerald-600'}`}>
                      {t.type === 'partner_draw' ? '-' : '+'}{formatKES(t.amount)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEditTxn(t)} className="p-1 hover:bg-slate-200 rounded"><Edit2 size={14} className="text-slate-500" /></button>
                        <button onClick={() => handleVoidTxn(t)} className="p-1 hover:bg-red-100 rounded"><Trash2 size={14} className="text-red-500" /></button>
                      </div>
                    </td>
                  </tr>
                  {editingTxnId === t.id && (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 bg-slate-50">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <input type="date" value={txnEditForm.date} onChange={(e) => setTxnEditForm({ ...txnEditForm, date: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                          <input type="number" min="0" value={txnEditForm.amount} onChange={(e) => setTxnEditForm({ ...txnEditForm, amount: e.target.value })} placeholder="Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                          <select value={txnEditForm.mode} onChange={(e) => setTxnEditForm({ ...txnEditForm, mode: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                            <option value="cash">Cash</option>
                            <option value="mpesa">Mpesa</option>
                            <option value="paybill">Paybill</option>
                          </select>
                          <input type="text" value={txnEditForm.notes} onChange={(e) => setTxnEditForm({ ...txnEditForm, notes: e.target.value })} placeholder="Notes" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button onClick={handleUpdateTxn} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-medium">Save</button>
                          <button onClick={() => setEditingTxnId(null)} className="text-slate-500 hover:text-slate-700 text-xs">Cancel</button>
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

      {/* Edit Share Rule Modal - shortcut so you don't have to go to Profit & Loss */}
      {showEditRules && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Edit Profit Share Rule</h3>
              <button onClick={() => setShowEditRules(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setRuleForm({ ...ruleForm, type: 'fixed' })}
                  className={`px-3 py-1.5 rounded-lg text-sm ${ruleForm.type === 'fixed' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}
                >
                  Fixed Amount
                </button>
                <button
                  onClick={() => setRuleForm({ ...ruleForm, type: 'percentage' })}
                  className={`px-3 py-1.5 rounded-lg text-sm ${ruleForm.type === 'percentage' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}
                >
                  Percentage
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Taher {ruleForm.type === 'fixed' ? '(KES)' : '(%)'}</label>
                <input type="number" value={ruleForm.taherValue} onChange={(e) => setRuleForm({ ...ruleForm, taherValue: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Abdulqadir {ruleForm.type === 'fixed' ? '(KES)' : '(%)'}</label>
                <input type="number" value={ruleForm.abdulqadirValue} onChange={(e) => setRuleForm({ ...ruleForm, abdulqadirValue: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <button onClick={guardRules(handleSaveRules)} disabled={savingRules} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">{savingRules ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Draw Modal - a real popup, so it's visible no matter how far down the page you've scrolled */}
      {showDraw && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowDraw(false); }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Take Money from Shop</h3>
            <button onClick={() => setShowDraw(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={drawForm.amount} onChange={(e) => setDrawForm({ ...drawForm, amount: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" value={drawForm.date} onChange={(e) => setDrawForm({ ...drawForm, date: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mode</label><select value={drawForm.mode} onChange={(e) => setDrawForm({ ...drawForm, mode: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="cash">Cash</option><option value="mpesa">Mpesa</option><option value="paybill">Paybill</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={drawForm.notes} onChange={(e) => setDrawForm({ ...drawForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
            <div className="flex gap-3">
              <button onClick={guardDraw(handleDraw)} disabled={savingDraw} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> {savingDraw ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setShowDraw(false)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Return Modal - a real popup, so it's visible no matter how far down the page you've scrolled */}
      {showReturn && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowReturn(false); }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Return Money to Shop</h3>
            <button onClick={() => setShowReturn(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={returnForm.amount} onChange={(e) => setReturnForm({ ...returnForm, amount: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" value={returnForm.date} onChange={(e) => setReturnForm({ ...returnForm, date: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mode</label><select value={returnForm.mode} onChange={(e) => setReturnForm({ ...returnForm, mode: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="cash">Cash</option><option value="mpesa">Mpesa</option><option value="paybill">Paybill</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={returnForm.notes} onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
            <div className="flex gap-3">
              <button onClick={guardReturn(handleReturn)} disabled={savingReturn} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> {savingReturn ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setShowReturn(false)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Mark Taken Modal - a real popup, so it's visible no matter how far down the page you've scrolled */}
      {showMarkTaken && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowMarkTaken(null); }}
        >
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-form-nav>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Mark {showMarkTaken.type === 'profit' ? 'Profit Share' : 'Home Expense'} as Taken</h3>
            <button onClick={() => setShowMarkTaken(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={markForm.amount} onChange={(e) => setMarkForm({ ...markForm, amount: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" value={markForm.date} onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mode</label><select value={markForm.mode} onChange={(e) => setMarkForm({ ...markForm, mode: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="cash">Cash</option><option value="mpesa">Mpesa</option><option value="paybill">Paybill</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={markForm.notes} onChange={(e) => setMarkForm({ ...markForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
            <div className="flex gap-3">
              <button onClick={guardMarkTaken(handleMarkTaken)} disabled={savingMarkTaken} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> {savingMarkTaken ? 'Saving...' : 'Mark Taken'}</button>
              <button onClick={() => setShowMarkTaken(null)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Profit Share Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-500" />
          <h3 className="font-semibold text-slate-800">Profit Share History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Earned</th>
                <th className="px-4 py-2 text-right">Taken</th>
                <th className="px-4 py-2 text-right">Remaining</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profitShares.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No profit share records</td></tr>
              ) : (
                profitShares.map((ps) => (
                  <tr key={ps.month} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 font-medium text-slate-800">{getMonthLabel(ps.month)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(ps.earned)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(ps.taken)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatKES(ps.remaining)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        ps.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        ps.status === 'taken' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {ps.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {ps.remaining > 0 && (
                        <button
                          onClick={() => {
                            setShowMarkTaken({ type: 'profit', amount: ps.remaining, id: ps.month });
                            setMarkForm({ ...emptyDraw, date: todayStr(), amount: String(ps.remaining) });
                          }}
                          className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-2 py-1 rounded transition-colors"
                        >
                          Mark Taken
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Home Expenses Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <TrendingDown size={18} className="text-blue-500" />
          <h3 className="font-semibold text-slate-800">Home Expenses (From Own Pocket)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {homeExpenses.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No home expenses from own pocket</td></tr>
              ) : (
                homeExpenses.map((he) => (
                  <tr key={he.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 text-slate-600">{formatDate(he.date)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatKES(he.amount)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        he.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {he.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {he.status === 'pending' && (
                        <button
                          onClick={() => {
                            setShowMarkTaken({ type: 'expense', amount: he.amount, id: he.id });
                            setMarkForm({ ...emptyDraw, date: todayStr(), amount: String(he.amount) });
                          }}
                          className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-2 py-1 rounded transition-colors"
                        >
                          Mark Taken
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title={`${activePartner} Ledger`}
        filterPartnerId={activePartner}
      />
    </div>
  );
}
