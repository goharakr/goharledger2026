import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Plus,
  X,
  Save,
  Wallet,
  Phone,
  Landmark,
  BookOpen,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, todayStr } from '../utils/format';
import { insertTransactionWithId } from '../utils/transactionId';
import { fetchAllRows } from '../utils/fetchAll';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import LedgerModal from '../components/LedgerModal';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Transaction } from '../types';

interface TransferForm {
  date: string;
  fromMode: string;
  toMode: string;
  amount: string;
  notes: string;
}

const emptyTransfer: TransferForm = {
  date: new Date().toISOString().split('T')[0],
  fromMode: 'cash',
  toMode: 'mpesa',
  amount: '',
  notes: '',
};

export default function CashBank() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [splits, setSplits] = useState<{ transaction_id: string; mode: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMode, setActiveMode] = useState<string>('all');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState<TransferForm>(emptyTransfer);
  const [reconcileMode, setReconcileMode] = useState<string>('');
  const [ledgerDatePreset, setLedgerDatePreset] = useState<DatePreset>('month');
  const [ledgerCustomFrom, setLedgerCustomFrom] = useState('');
  const [ledgerCustomTo, setLedgerCustomTo] = useState('');
  const [reconcileAmount, setReconcileAmount] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const [showOpeningBalance, setShowOpeningBalance] = useState(false);
  const [openingMode, setOpeningMode] = useState('cash');
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingDate, setOpeningDate] = useState(todayStr());

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: txns }, { data: splitData }] = await Promise.all([
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, to)
      ),
      supabase.from('transaction_splits').select('*'),
    ]);
    setTransactions(txns || []);
    setSplits(splitData || []);
    setLoading(false);
  }

  function calculateBalances() {
    let mpesa = 0, cash = 0, paybill = 0;
    let mpesaAdvance = 0, cashAdvance = 0, paybillAdvance = 0;
    const splitMap = new Map<string, { mode: string; amount: number }[]>();
    splits.forEach((s) => {
      if (!splitMap.has(s.transaction_id)) splitMap.set(s.transaction_id, []);
      splitMap.get(s.transaction_id)!.push(s);
    });

    transactions.forEach((t) => {
      // Sales add to balance
      if (t.type === 'sale') {
        if (t.primary_mode === 'mpesa') {
          mpesa += t.amount;
        }
        else if (t.primary_mode === 'cash') {
          cash += t.amount;
        }
        else if (t.primary_mode === 'paybill') {
          paybill += t.amount;
        }
        // 'advance' mode sales don't add anything here - that cash was already
        // counted when the advance was deposited (a customer_payment below), so
        // counting it again here would double it. It reduces the "held for
        // customers" sub-line instead, since it's no longer an outstanding advance.
        else if (t.primary_mode === 'advance') {
          if (t.settlement_mode === 'mpesa') mpesaAdvance -= t.amount;
          else if (t.settlement_mode === 'cash') cashAdvance -= t.amount;
          else if (t.settlement_mode === 'paybill') paybillAdvance -= t.amount;
        }
        else if (t.primary_mode === 'split') {
          const s = splitMap.get(t.transaction_id) || [];
          s.forEach((sp) => {
            if (sp.mode === 'mpesa') mpesa += sp.amount;
            else if (sp.mode === 'cash') cash += sp.amount;
            else if (sp.mode === 'paybill') paybill += sp.amount;
          });
        }
        // Deduct commission from the respective mode
        if (t.commission && t.commission > 0 && t.commission_mode) {
          if (t.commission_mode === 'mpesa') mpesa -= t.commission;
          else if (t.commission_mode === 'cash') cash -= t.commission;
          else if (t.commission_mode === 'paybill') paybill -= t.commission;
        }
      } else if (t.type === 'expense') {
        const isHomeExpenseFromOwnPocket = t.category === 'home_expense' && t.notes?.includes('From Own Pocket');
        // A post-dated cheque hasn't left the bank yet - don't deduct it
        // until its "clears on" date actually arrives.
        const isPendingClear = t.clears_on && t.clears_on > todayStr();
        if (!isHomeExpenseFromOwnPocket && !isPendingClear) {
          if (t.primary_mode === 'mpesa') mpesa -= t.amount;
          else if (t.primary_mode === 'cash') cash -= t.amount;
          else if (t.primary_mode === 'paybill') paybill -= t.amount;
        }
      } else if (t.type === 'customer_payment') {
        const isAdvanceDeposit = t.description?.startsWith('Advance from') || t.transaction_id.startsWith('OPN-ADV-');
        if (t.primary_mode === 'mpesa') { mpesa += t.amount; if (isAdvanceDeposit) mpesaAdvance += t.amount; }
        else if (t.primary_mode === 'cash') { cash += t.amount; if (isAdvanceDeposit) cashAdvance += t.amount; }
        else if (t.primary_mode === 'paybill') { paybill += t.amount; if (isAdvanceDeposit) paybillAdvance += t.amount; }
      } else if (t.type === 'opening_balance') {
        if (t.primary_mode === 'mpesa') mpesa += t.amount;
        else if (t.primary_mode === 'cash') cash += t.amount;
        else if (t.primary_mode === 'paybill') paybill += t.amount;
      } else if (t.type === 'supplier_payment') {
        // Supplier payments deduct from mode balance, unless it's a
        // post-dated cheque that hasn't cleared the bank yet.
        if (!(t.clears_on && t.clears_on > todayStr())) {
          if (t.primary_mode === 'mpesa') mpesa -= t.amount;
          else if (t.primary_mode === 'cash') cash -= t.amount;
          else if (t.primary_mode === 'paybill') paybill -= t.amount;
        }
      } else if (t.type === 'partner_draw') {
        if (t.primary_mode === 'mpesa') mpesa -= t.amount;
        else if (t.primary_mode === 'cash') cash -= t.amount;
        else if (t.primary_mode === 'paybill') paybill -= t.amount;
      } else if (t.type === 'partner_loan') {
        if (t.primary_mode === 'mpesa') mpesa += t.amount;
        else if (t.primary_mode === 'cash') cash += t.amount;
        else if (t.primary_mode === 'paybill') paybill += t.amount;
      } else if (t.type === 'loan_payment') {
        if (t.primary_mode === 'mpesa') mpesa -= t.amount;
        else if (t.primary_mode === 'cash') cash -= t.amount;
        else if (t.primary_mode === 'paybill') paybill -= t.amount;
      } else if (t.type === 'capital_entry') {
        if (t.primary_mode === 'mpesa') mpesa += t.amount;
        else if (t.primary_mode === 'cash') cash += t.amount;
        else if (t.primary_mode === 'paybill') paybill += t.amount;
      } else if (t.type === 'fund_transfer') {
        const desc = (t.description || '').toLowerCase();
        if (desc.includes('mpesa to cash')) { mpesa -= t.amount; cash += t.amount; }
        else if (desc.includes('cash to mpesa')) { cash -= t.amount; mpesa += t.amount; }
        else if (desc.includes('mpesa to paybill')) { mpesa -= t.amount; paybill += t.amount; }
        else if (desc.includes('paybill to mpesa')) { paybill -= t.amount; mpesa += t.amount; }
        else if (desc.includes('cash to paybill')) { cash -= t.amount; paybill += t.amount; }
        else if (desc.includes('paybill to cash')) { paybill -= t.amount; cash += t.amount; }
      }
    });

    return { mpesa, cash, paybill, mpesaAdvance, cashAdvance, paybillAdvance };
  }

  async function handleTransfer() {
    if (!transferForm.amount || parseFloat(transferForm.amount) <= 0) return;
    if (transferForm.fromMode === transferForm.toMode) return;

    const amt = parseFloat(transferForm.amount);
    const desc = `${transferForm.fromMode} to ${transferForm.toMode}`;

    const { data: newTxn, error } = await insertTransactionWithId('TXN-' + transferForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: transferForm.date,
      type: 'fund_transfer',
      primary_mode: transferForm.fromMode,
      amount: amt,
      description: desc,
      notes: transferForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save transfer: ' + (error?.message || 'unknown error')); return; }

    setTransferForm(emptyTransfer);
    setShowTransfer(false);
    fetchData();
    triggerRefresh();
  }

  function openingBalanceTxnId(mode: string) {
    return `OPN-${mode.toUpperCase()}`;
  }

  async function handleSetOpeningBalance() {
    const amt = parseFloat(openingAmount || '0');
    if (amt < 0) return;

    // Look up the mirror row directly (not from is_void-filtered state) so a
    // previously-voided row is found and revived instead of re-inserted, which
    // would fail against the transaction_id unique constraint.
    const txnId = openingBalanceTxnId(openingMode);
    const { data: existing } = await supabase.from('transactions').select('*').eq('transaction_id', txnId).maybeSingle();

    if (existing) {
      if (amt > 0) {
        await supabase.from('transactions').update({
          date: openingDate,
          amount: amt,
          is_void: false,
          edited_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else if (!existing.is_void) {
        await supabase.from('transactions').update({ is_void: true, void_reason: 'Opening balance removed' }).eq('id', existing.id);
      }
    } else if (amt > 0) {
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: openingDate,
        type: 'opening_balance',
        primary_mode: openingMode,
        amount: amt,
        description: `Opening balance - ${openingMode}`,
        created_by: user?.username || null,
      });
    }

    setOpeningAmount('');
    setShowOpeningBalance(false);
    fetchData();
    triggerRefresh();
  }

  function getLedgerEntries(mode: string) {
    const entries: { date: string; description: string; debit: number; credit: number; balance: number }[] = [];
    let balance = 0;
    const splitMap = new Map<string, { mode: string; amount: number }[]>();
    splits.forEach((s) => {
      if (!splitMap.has(s.transaction_id)) splitMap.set(s.transaction_id, []);
      splitMap.get(s.transaction_id)!.push(s);
    });

    const sorted = [...transactions].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    sorted.forEach((t) => {
      let debit = 0, credit = 0;

      if (t.type === 'sale') {
        if (mode === 'all') {
          if (t.primary_mode === 'mpesa') credit += t.amount;
          else if (t.primary_mode === 'cash') credit += t.amount;
          else if (t.primary_mode === 'paybill') credit += t.amount;
          else if (t.primary_mode === 'split') {
            const s = splitMap.get(t.transaction_id) || [];
            s.forEach((sp) => credit += sp.amount);
          }
          // Deduct commission from the respective mode
          if (t.commission && t.commission > 0) {
            if (t.commission_mode === 'mpesa') credit -= t.commission;
            else if (t.commission_mode === 'cash') credit -= t.commission;
            else if (t.commission_mode === 'paybill') credit -= t.commission;
          }
        } else if (t.primary_mode === mode) {
          credit += t.amount;
          // Deduct commission if this is the commission mode
          if (t.commission && t.commission > 0 && t.commission_mode === mode) {
            debit += t.commission;
          }
        } else if (t.primary_mode === 'split') {
          const s = splitMap.get(t.transaction_id) || [];
          const sp = s.find((x) => x.mode === mode);
          if (sp) credit += sp.amount;
          // A split sale's commission can still be paid from a mode that
          // wasn't part of the split itself - this was previously missed here.
          if (t.commission && t.commission > 0 && t.commission_mode === mode) {
            debit += t.commission;
          }
        } else {
          // Sale was in different mode but commission might be in this mode
          if (t.commission && t.commission > 0 && t.commission_mode === mode) {
            debit += t.commission;
          }
        }
      } else if (t.type === 'expense') {
        const isHomeExpenseFromOwnPocket = t.category === 'home_expense' && t.notes?.includes('From Own Pocket');
        const isPendingClear = t.clears_on && t.clears_on > todayStr();
        if (!isHomeExpenseFromOwnPocket && !isPendingClear) {
          if (mode === 'all') {
            if (t.primary_mode === 'mpesa') debit += t.amount;
            else if (t.primary_mode === 'cash') debit += t.amount;
            else if (t.primary_mode === 'paybill') debit += t.amount;
          } else if (t.primary_mode === mode) {
            debit += t.amount;
          }
        }
      } else if (t.type === 'customer_payment') {
        if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
      } else if (t.type === 'opening_balance') {
        if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
      } else if (t.type === 'supplier_payment') {
        if (!(t.clears_on && t.clears_on > todayStr()) && (mode === 'all' || t.primary_mode === mode)) debit += t.amount;
      } else if (t.type === 'partner_draw') {
        if (mode === 'all' || t.primary_mode === mode) debit += t.amount;
      } else if (t.type === 'partner_loan') {
        if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
      } else if (t.type === 'loan_payment') {
        if (mode === 'all' || t.primary_mode === mode) debit += t.amount;
      } else if (t.type === 'capital_entry' && t.primary_mode) {
        // Unlike opening_balance/customer_payment, a capital entry can
        // legitimately have no wallet mode (e.g. Retained Profit isn't real
        // new cash), so it must not be counted in the "All" total either.
        if (mode === 'all' || t.primary_mode === mode) credit += t.amount;
      } else if (t.type === 'fund_transfer') {
        const desc = (t.description || '').toLowerCase();
        if (mode === 'all') {
          if (desc.includes('mpesa to cash')) { debit += t.amount; }
          else if (desc.includes('cash to mpesa')) { debit += t.amount; }
          else if (desc.includes('mpesa to paybill')) { debit += t.amount; }
          else if (desc.includes('paybill to mpesa')) { debit += t.amount; }
          else if (desc.includes('cash to paybill')) { debit += t.amount; }
          else if (desc.includes('paybill to cash')) { debit += t.amount; }
        } else {
          if (desc.includes(`${mode} to`)) debit += t.amount;
          else if (desc.includes(`to ${mode}`)) credit += t.amount;
        }
      }

      if (debit > 0 || credit > 0) {
        balance += credit - debit;
        entries.push({
          date: t.date,
          description: t.description || t.transaction_id,
          debit,
          credit,
          balance,
        });
      }
    });

    // Running balance is computed over full history above (so it stays
    // correct); only the displayed rows are narrowed to the selected range.
    const { from, to } = getDatePresetRange(ledgerDatePreset, ledgerCustomFrom, ledgerCustomTo);
    return entries.filter((e) => e.date >= from && e.date <= to);
  }

  const balances = calculateBalances();
  const ledger = getLedgerEntries(activeMode);

  return (
    <div className="space-y-6">
      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BalanceCard title="Mpesa" amount={balances.mpesa} advance={balances.mpesaAdvance} icon={<Phone size={20} />} color="bg-blue-500" />
        <BalanceCard title="Cash" amount={balances.cash} advance={balances.cashAdvance} icon={<Wallet size={20} />} color="bg-emerald-500" />
        <BalanceCard title="Paybill" amount={balances.paybill} advance={balances.paybillAdvance} icon={<Landmark size={20} />} color="bg-amber-500" />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { setShowTransfer(true); setTransferForm({ ...emptyTransfer, date: todayStr() }); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <ArrowLeftRight size={16} /> Fund Transfer
        </button>
        <button
          onClick={() => {
            const existing = transactions.find((t) => t.transaction_id === openingBalanceTxnId(openingMode));
            setOpeningAmount(existing ? String(existing.amount) : '');
            setOpeningDate(todayStr());
            setShowOpeningBalance(true);
          }}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Wallet size={16} /> Set Opening Balance
        </button>
        <button
          onClick={() => setShowLedger(true)}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Opening Balance Modal */}
      {showOpeningBalance && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Set Opening Balance</h3>
            <button onClick={() => setShowOpeningBalance(false)} className="p-1 hover:bg-slate-100 rounded">
              <X size={18} />
            </button>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Use this to enter your starting Cash/Mpesa/Paybill balance when you begin using the app - it's added on top of whatever transactions already exist, one canonical entry per mode that you can come back and edit.
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mode</label>
                <select
                  value={openingMode}
                  onChange={(e) => {
                    const m = e.target.value;
                    setOpeningMode(m);
                    const existing = transactions.find((t) => t.transaction_id === openingBalanceTxnId(m));
                    setOpeningAmount(existing ? String(existing.amount) : '');
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">Mpesa</option>
                  <option value="paybill">Paybill</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                <input type="number" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSetOpeningBalance} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                <Save size={16} /> Save
              </button>
              <button onClick={() => setShowOpeningBalance(false)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransfer && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Fund Transfer</h3>
            <button onClick={() => setShowTransfer(false)} className="p-1 hover:bg-slate-100 rounded">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">From</label>
                <select value={transferForm.fromMode} onChange={(e) => setTransferForm({ ...transferForm, fromMode: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option value="cash">Cash</option>
                  <option value="mpesa">Mpesa</option>
                  <option value="paybill">Paybill</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">To</label>
                <select value={transferForm.toMode} onChange={(e) => setTransferForm({ ...transferForm, toMode: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option value="cash">Cash</option>
                  <option value="mpesa">Mpesa</option>
                  <option value="paybill">Paybill</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                <input type="number" value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={handleTransfer} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                <Save size={16} /> Transfer
              </button>
              <button onClick={() => setShowTransfer(false)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mode Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {(['all', 'mpesa', 'cash', 'paybill'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setActiveMode(mode)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {mode === 'all' ? 'Combined' : mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Reconciliation */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-3">Reconciliation</h3>
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={reconcileMode}
            onChange={(e) => setReconcileMode(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          >
            <option value="">Select mode</option>
            <option value="mpesa">Mpesa</option>
            <option value="cash">Cash</option>
            <option value="paybill">Paybill</option>
          </select>
          <input
            type="number"
            value={reconcileAmount}
            onChange={(e) => setReconcileAmount(e.target.value)}
            placeholder="Physical amount"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          {reconcileMode && (
            <div className="text-sm">
              <span className="text-slate-500">System: </span>
              <span className="font-medium">
                KES {formatKES(reconcileMode === 'mpesa' ? balances.mpesa : reconcileMode === 'cash' ? balances.cash : balances.paybill)}
              </span>
              {reconcileAmount && (
                <>
                  <span className="text-slate-500 ml-3">Difference: </span>
                  <span className={`font-medium ${
                    parseFloat(reconcileAmount) - (reconcileMode === 'mpesa' ? balances.mpesa : reconcileMode === 'cash' ? balances.cash : balances.paybill) === 0
                      ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    KES {formatKES(parseFloat(reconcileAmount) - (reconcileMode === 'mpesa' ? balances.mpesa : reconcileMode === 'cash' ? balances.cash : balances.paybill))}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ledger */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-slate-800">
            {activeMode === 'all' ? 'Combined Ledger' : `${activeMode.charAt(0).toUpperCase() + activeMode.slice(1)} Ledger`}
          </h3>
          <DateFilterBar
            preset={ledgerDatePreset}
            customFrom={ledgerCustomFrom}
            customTo={ledgerCustomTo}
            onChange={(p, from, to) => { setLedgerDatePreset(p); setLedgerCustomFrom(from); setLedgerCustomTo(to); }}
          />
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : ledger.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No entries</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2 text-right">Debit</th>
                  <th className="px-4 py-2 text-right">Credit</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((entry, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 text-slate-600">{formatDate(entry.date)}</td>
                    <td className="px-4 py-2 text-slate-700">{entry.description}</td>
                    <td className="px-4 py-2 text-right text-red-600">{entry.debit > 0 ? formatKES(entry.debit) : ''}</td>
                    <td className="px-4 py-2 text-right text-emerald-600">{entry.credit > 0 ? formatKES(entry.credit) : ''}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">{formatKES(entry.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title="Cash & Bank Ledger"
      />
    </div>
  );
}

function BalanceCard({ title, amount, advance, icon, color }: { title: string; amount: number; advance?: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-500">{title} Balance</span>
        <div className={`w-8 h-8 ${color} rounded-lg flex items-center justify-center text-white`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800">KES {formatKES(amount)}</p>
      {advance && advance > 0 && (
        <p className="text-xs text-red-600 mt-1">Includes KES {formatKES(advance)} advance</p>
      )}
    </div>
  );
}