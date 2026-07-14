import { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Save,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, getMonthLabel, saleProfit } from '../utils/format';
import { useDataRefresh } from '../context/DataContext';
import LedgerModal from '../components/LedgerModal';
import { fetchAllRows } from '../utils/fetchAll';
import type { Transaction, ShareRule, HistoricalProfit } from '../types';

export default function ProfitLoss() {
  const { refreshKey } = useDataRefresh();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [shareRules, setShareRules] = useState<ShareRule[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [loading, setLoading] = useState(true);
  const [editingRules, setEditingRules] = useState(false);
  const [ruleForm, setRuleForm] = useState({ type: 'fixed' as 'fixed' | 'percentage', taherValue: '100000', abdulqadirValue: '100000' });
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: rules }, { data: hist }] = await Promise.all([
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).range(from, to)
      ),
      supabase.from('share_rules').select('*').eq('is_active', true),
      supabase.from('historical_profit').select('*').order('month', { ascending: false }),
    ]);
    setTransactions(txns || []);
    setShareRules(rules || []);
    setHistoricalProfit(hist || []);

    if (rules && rules.length > 0) {
      const taherRule = rules.find((r) => r.partner_id === 'taher');
      const abdulRule = rules.find((r) => r.partner_id === 'abdulqadir');
      if (taherRule && abdulRule) {
        setRuleForm({
          type: taherRule.rule_type as 'fixed' | 'percentage',
          taherValue: String(taherRule.value),
          abdulqadirValue: String(abdulRule.value),
        });
      }
    }
    setLoading(false);
  }

  async function saveRules() {
    const now = new Date().toISOString().split('T')[0];

    // Deactivate old rules
    await supabase.from('share_rules').update({ is_active: false, effective_to: now }).eq('is_active', true);

    await supabase.from('share_rules').insert([
      {
        partner_id: 'taher',
        rule_type: ruleForm.type,
        value: parseFloat(ruleForm.taherValue),
        effective_from: now,
        is_active: true,
      },
      {
        partner_id: 'abdulqadir',
        rule_type: ruleForm.type,
        value: parseFloat(ruleForm.abdulqadirValue),
        effective_from: now,
        is_active: true,
      },
    ]);

    setEditingRules(false);
    fetchData();
  }

  function calculateMonthData(month: string) {
    const monthStart = month + '-01';
    const monthEnd = month + '-31';

    const monthTxns = transactions.filter((t) => t.date >= monthStart && t.date <= monthEnd);

    const sales = monthTxns.filter((t) => t.type === 'sale');
    const totalSP = sales.reduce((s, t) => s + (t.selling_price || 0), 0);
    const totalCommission = sales.reduce((s, t) => s + (t.commission || 0), 0);
    // A sale with no cost price yet contributes 0 profit (not full selling
    // price) until the real cost is filled in - see saleProfit(). Cost of
    // Goods is then derived backward so the waterfall (SP - CP - Commission
    // = Gross Profit) stays internally consistent.
    const grossProfit = sales.reduce((s, t) => s + saleProfit(t), 0);
    const totalCP = totalSP - totalCommission - grossProfit;

    const shopExpenses = monthTxns
      .filter((t) => t.type === 'expense' && t.category !== 'home_expense' && t.category !== 'stock' && t.category !== 'supplier_payment')
      .reduce((s, t) => s + t.amount, 0);

    const homeExpensesFromShop = monthTxns
      .filter((t) => t.type === 'expense' && t.category === 'home_expense' && t.notes?.includes('From Shop'))
      .reduce((s, t) => s + t.amount, 0);

    const loanPayments = monthTxns
      .filter((t) => t.type === 'loan_payment')
      .reduce((s, t) => s + t.amount, 0);

    const netProfit = grossProfit - shopExpenses - homeExpensesFromShop - loanPayments;

    // Get active rules for this month
    const activeRule = shareRules.find((r) => r.partner_id === 'taher' && r.is_active);
    const ruleType = activeRule?.rule_type || 'fixed';
    const taherVal = activeRule?.value || 100000;
    const abdulVal = shareRules.find((r) => r.partner_id === 'abdulqadir' && r.is_active)?.value || 100000;

    let taherShare = 0, abdulqadirShare = 0, retained = 0;

    if (ruleType === 'fixed') {
      taherShare = taherVal;
      abdulqadirShare = abdulVal;
      retained = netProfit - taherShare - abdulqadirShare;
    } else {
      taherShare = netProfit * (taherVal / 100);
      abdulqadirShare = netProfit * (abdulVal / 100);
      retained = netProfit - taherShare - abdulqadirShare;
    }

    return {
      totalSP,
      totalCP,
      totalCommission,
      grossProfit,
      shopExpenses,
      homeExpensesFromShop,
      loanPayments,
      netProfit,
      taherShare,
      abdulqadirShare,
      retained,
      ruleType,
      taherVal,
      abdulVal,
    };
  }

  const data = calculateMonthData(selectedMonth);

  // Generate month options
  const months: string[] = [];
  const start = new Date(2024, 5, 1); // June 2024
  const now = new Date();
  while (start <= now) {
    months.push(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`);
    start.setMonth(start.getMonth() + 1);
  }

  const colorClasses: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
  };

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Month:</label>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          {months.map((m) => (
            <option key={m} value={m}>{getMonthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-4 ${colorClasses.emerald}`}>
          <p className="text-sm opacity-80">Gross Profit</p>
          <p className="text-2xl font-bold">KES {formatKES(data.grossProfit)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${colorClasses[data.netProfit >= 0 ? 'emerald' : 'red']}`}>
          <p className="text-sm opacity-80">Net Profit</p>
          <p className="text-2xl font-bold">KES {formatKES(data.netProfit)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${colorClasses.blue}`}>
          <p className="text-sm opacity-80">Retained Earnings</p>
          <p className="text-2xl font-bold">KES {formatKES(data.retained)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${colorClasses.slate}`}>
          <p className="text-sm opacity-80">Total Sales</p>
          <p className="text-2xl font-bold">KES {formatKES(data.totalSP)}</p>
        </div>
      </div>

      {/* Profit Waterfall */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-semibold text-slate-800 mb-6">Profit Waterfall - {getMonthLabel(selectedMonth)}</h3>
        <div className="space-y-3">
          <WaterfallRow label="Total Sales (SP)" value={data.totalSP} indent={0} />
          <WaterfallRow label="Cost of Goods (CP)" value={-data.totalCP} indent={1} negative />
          <WaterfallRow label="Commissions" value={-data.totalCommission} indent={1} negative />
          <WaterfallRow label="= Gross Profit" value={data.grossProfit} indent={0} bold highlight />
          <WaterfallRow label="Shop Expenses" value={-data.shopExpenses} indent={1} negative />
          <WaterfallRow label="Home Expenses (from Shop)" value={-data.homeExpensesFromShop} indent={1} negative />
          <WaterfallRow label="Loan Repayments" value={-data.loanPayments} indent={1} negative />
          <WaterfallRow label="= Net Profit" value={data.netProfit} indent={0} bold highlight />
          <WaterfallRow label={`Taher Share (${data.ruleType === 'fixed' ? 'Fixed' : data.taherVal + '%'})`} value={-data.taherShare} indent={1} negative />
          <WaterfallRow label={`Abdulqadir Share (${data.ruleType === 'fixed' ? 'Fixed' : data.abdulVal + '%'})`} value={-data.abdulqadirShare} indent={1} negative />
          <WaterfallRow label="= Retained Earnings" value={data.retained} indent={0} bold highlight />
        </div>
      </div>

      {/* Share Rules */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">Share Rules</h3>
          <button
            onClick={() => setEditingRules(!editingRules)}
            className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
          >
            {editingRules ? 'Cancel' : 'Edit Rules'}
          </button>
        </div>

        {editingRules ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Rule Type:</label>
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
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Taher {ruleForm.type === 'fixed' ? '(KES)' : '(%)'}</label>
                <input
                  type="number"
                  value={ruleForm.taherValue}
                  onChange={(e) => setRuleForm({ ...ruleForm, taherValue: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Abdulqadir {ruleForm.type === 'fixed' ? '(KES)' : '(%)'}</label>
                <input
                  type="number"
                  value={ruleForm.abdulqadirValue}
                  onChange={(e) => setRuleForm({ ...ruleForm, abdulqadirValue: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <button onClick={saveRules} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              <Save size={16} /> Save Rules
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500">Taher</p>
              <p className="text-lg font-bold text-slate-800">
                {data.ruleType === 'fixed' ? `KES ${formatKES(data.taherVal)}` : `${data.taherVal}%`}
              </p>
              <p className="text-xs text-slate-400">{data.ruleType === 'fixed' ? 'Fixed amount' : 'Percentage of net profit'}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500">Abdulqadir</p>
              <p className="text-lg font-bold text-slate-800">
                {data.ruleType === 'fixed' ? `KES ${formatKES(data.abdulVal)}` : `${data.abdulVal}%`}
              </p>
              <p className="text-xs text-slate-400">{data.ruleType === 'fixed' ? 'Fixed amount' : 'Percentage of net profit'}</p>
            </div>
          </div>
        )}
      </div>

      {/* View Ledger Button */}
      <div className="flex items-center gap-3">
        <button onClick={() => setShowLedger(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Month History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Month-by-Month History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Sales</th>
                <th className="px-4 py-2 text-right">Cost</th>
                <th className="px-4 py-2 text-right">Gross Profit</th>
                <th className="px-4 py-2 text-right">Net Profit</th>
                <th className="px-4 py-2 text-right">Taher</th>
                <th className="px-4 py-2 text-right">Abdulqadir</th>
                <th className="px-4 py-2 text-right">Retained</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historicalProfit.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No historical data</td></tr>
              ) : (
                historicalProfit.map((h) => (
                  <tr key={h.month} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 font-medium">{getMonthLabel(h.month)}</td>
                    <td className="px-4 py-2 text-right">-</td>
                    <td className="px-4 py-2 text-right">-</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.total_profit)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.total_profit)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.taher_share || 0)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.abdulqadir_share || 0)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.retained || 0)}</td>
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
        title="Profit & Loss Ledger"
        filterTypes={['sale', 'expense', 'partner_draw', 'supplier_payment']}
      />
    </div>
  );
}

function WaterfallRow({ label, value, indent, negative, bold, highlight }: {
  label: string;
  value: number;
  indent: number;
  negative?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${highlight ? 'bg-slate-50 rounded-lg p-2 -mx-2' : ''}`}>
      <div className="flex-1" style={{ paddingLeft: `${indent * 24}px` }}>
        <span className={`text-sm ${bold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{label}</span>
      </div>
      <div className={`text-right font-medium text-sm ${
        negative ? 'text-red-600' : bold ? 'text-emerald-600' : 'text-slate-700'
      }`}>
        {negative ? '-' : ''}KES {formatKES(Math.abs(value))}
      </div>
    </div>
  );
}