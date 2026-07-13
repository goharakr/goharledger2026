import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  X,
  Save,
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, getMonthLabel, todayStr } from '../utils/format';
import { insertTransactionWithId } from '../utils/transactionId';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
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
  date: new Date().toISOString().split('T')[0],
  mode: 'cash',
  notes: '',
};

export default function Partners() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const partnerParam = searchParams.get('partner');
  const [activePartner, setActivePartner] = useState<'taher' | 'abdulqadir'>(
    partnerParam === 'abdulqadir' || partnerParam === 'taher'
      ? partnerParam
      : user?.username === 'abdulqadir' ? 'abdulqadir' : 'taher'
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [shareRules, setShareRules] = useState<{ partner_id: string; rule_type: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDraw, setShowDraw] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [drawForm, setDrawForm] = useState<DrawForm>(emptyDraw);
  const [returnForm, setReturnForm] = useState<DrawForm>(emptyDraw);
  const [showMarkTaken, setShowMarkTaken] = useState<{ type: 'profit' | 'expense'; amount: number; id: string } | null>(null);
  const [markForm, setMarkForm] = useState<DrawForm>(emptyDraw);
  const [showLedger, setShowLedger] = useState(false);

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
      supabase.from('transactions').select('*').order('date', { ascending: false }),
      supabase.from('historical_profit').select('*').order('month', { ascending: false }),
      supabase.from('share_rules').select('*').eq('is_active', true),
    ]);
    setTransactions(txns || []);
    setHistoricalProfit(hist || []);
    setShareRules(rules || []);
    setLoading(false);
  }

  // Mirrors Dashboard's "Share due" calc: applies the active share rule across
  // every month with transactions, plus any historical carry-over, minus draws.
  function calculateShareDue(partner: string) {
    const rule = shareRules.find((r) => r.partner_id === partner);
    if (!rule) return 0;

    const monthly = new Map<string, { grossProfit: number; shopExpenses: number; homeExpensesFromShop: number; loanPayments: number }>();
    transactions.forEach((t) => {
      if (t.is_void || !t.date) return;
      const key = t.date.slice(0, 7);
      if (!monthly.has(key)) monthly.set(key, { grossProfit: 0, shopExpenses: 0, homeExpensesFromShop: 0, loanPayments: 0 });
      const m = monthly.get(key)!;
      if (t.type === 'sale') {
        m.grossProfit += (t.selling_price || 0) - (t.cost_price || 0) - (t.commission || 0);
      } else if (t.type === 'expense' && t.category !== 'stock' && t.category !== 'supplier_payment') {
        if (t.category === 'home_expense') {
          if (t.notes?.includes('From Shop')) m.homeExpensesFromShop += t.amount;
        } else {
          m.shopExpenses += t.amount;
        }
      } else if (t.type === 'loan_payment') {
        m.loanPayments += t.amount;
      }
    });

    let earned = 0;
    monthly.forEach((m) => {
      const netProfit = m.grossProfit - m.shopExpenses - m.homeExpensesFromShop - m.loanPayments;
      earned += rule.rule_type === 'fixed' ? rule.value : netProfit * (rule.value / 100);
    });

    const histRemaining = historicalProfit.reduce((s, h) => {
      const share = partner === 'taher' ? (h.taher_share || 0) : (h.abdulqadir_share || 0);
      const taken = partner === 'taher' ? (h.taher_taken || 0) : (h.abdulqadir_taken || 0);
      return s + share - taken;
    }, 0);

    const drawsAllTime = transactions.reduce((s, t) => (t.type === 'partner_draw' && t.partner_id === partner && !t.is_void ? s + t.amount : s), 0);

    return earned + histRemaining - drawsAllTime;
  }

  function calculateHomeOwed(partner: string) {
    let owed = 0;
    transactions.forEach((t) => {
      if (t.type === 'expense' && t.category === 'home_expense' && t.partner_id === partner && !t.is_void) {
        if (t.notes?.includes('From Own Pocket')) owed += t.amount;
        if (t.notes?.includes('From Shop') && t.notes?.includes('repaying')) owed -= t.amount;
      }
    });
    return owed;
  }

  function calculateTakenThisMonth(partner: string) {
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    return transactions.reduce((s, t) => (
      t.type === 'partner_draw' && t.partner_id === partner && !t.is_void && t.date >= monthStart ? s + t.amount : s
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

    setShowMarkTaken(null);
    setMarkForm(emptyDraw);
    fetchData();
    triggerRefresh();
  }

  const balance = calculatePartnerBalance(activePartner);
  const isPositive = balance >= 0;
  const shareDue = calculateShareDue(activePartner);
  const homeOwed = calculateHomeOwed(activePartner);
  const takenThisMonth = calculateTakenThisMonth(activePartner);

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

  return (
    <div className="space-y-6">
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
          <p className="text-sm text-slate-500">Share due</p>
          <p className={`text-xl font-bold ${shareDue >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>KES {formatKES(Math.abs(shareDue))}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm text-slate-500">Home expenses owed</p>
          <p className="text-xl font-bold text-blue-600">KES {formatKES(homeOwed)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm text-slate-500">Taken this month</p>
          <p className="text-xl font-bold text-slate-800">KES {formatKES(takenThisMonth)}</p>
        </div>
      </div>

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

      {/* Draw Modal */}
      {showDraw && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Take Money from Shop</h3>
            <button onClick={() => setShowDraw(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={drawForm.amount} onChange={(e) => setDrawForm({ ...drawForm, amount: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" value={drawForm.date} onChange={(e) => setDrawForm({ ...drawForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mode</label><select value={drawForm.mode} onChange={(e) => setDrawForm({ ...drawForm, mode: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="cash">Cash</option><option value="mpesa">Mpesa</option><option value="paybill">Paybill</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={drawForm.notes} onChange={(e) => setDrawForm({ ...drawForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
            <div className="flex gap-3">
              <button onClick={handleDraw} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> Save</button>
              <button onClick={() => setShowDraw(false)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {showReturn && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Return Money to Shop</h3>
            <button onClick={() => setShowReturn(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={returnForm.amount} onChange={(e) => setReturnForm({ ...returnForm, amount: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" value={returnForm.date} onChange={(e) => setReturnForm({ ...returnForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mode</label><select value={returnForm.mode} onChange={(e) => setReturnForm({ ...returnForm, mode: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="cash">Cash</option><option value="mpesa">Mpesa</option><option value="paybill">Paybill</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={returnForm.notes} onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
            <div className="flex gap-3">
              <button onClick={handleReturn} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> Save</button>
              <button onClick={() => setShowReturn(false)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Taken Modal */}
      {showMarkTaken && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Mark {showMarkTaken.type === 'profit' ? 'Profit Share' : 'Home Expense'} as Taken</h3>
            <button onClick={() => setShowMarkTaken(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Amount</label><input type="number" value={markForm.amount} onChange={(e) => setMarkForm({ ...markForm, amount: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" value={markForm.date} onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mode</label><select value={markForm.mode} onChange={(e) => setMarkForm({ ...markForm, mode: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="cash">Cash</option><option value="mpesa">Mpesa</option><option value="paybill">Paybill</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label><textarea value={markForm.notes} onChange={(e) => setMarkForm({ ...markForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
            <div className="flex gap-3">
              <button onClick={handleMarkTaken} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> Mark Taken</button>
              <button onClick={() => setShowMarkTaken(null)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">Cancel</button>
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
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {homeExpenses.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No home expenses from own pocket</td></tr>
              ) : (
                homeExpenses.map((he) => (
                  <tr key={he.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 text-slate-600">{formatDate(he.date)}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {he.description}
                      {he.createdBy && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Added by">
                          {he.createdBy}
                        </span>
                      )}
                    </td>
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
