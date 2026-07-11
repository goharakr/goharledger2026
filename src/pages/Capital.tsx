import { useEffect, useState } from 'react';
import {
  Plus,
  X,
  Save,
  Landmark,
  TrendingUp,
  Wallet,
  BookOpen,
  Trash2,
  Edit2,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, getMonthLabel, todayStr } from '../utils/format';
import { adjustLoanBalance } from '../utils/balances';
import { insertTransactionWithId } from '../utils/transactionId';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import LedgerModal from '../components/LedgerModal';
import type { CapitalEntry, LoanTracker, HistoricalProfit, Transaction } from '../types';

interface CapitalForm {
  partnerId: string;
  entryType: string;
  amount: string;
  date: string;
  description: string;
}

interface LoanPaymentForm {
  amount: string;
  date: string;
  mode: string;
  notes: string;
}

const emptyCapital: CapitalForm = {
  partnerId: 'taher',
  entryType: 'initial_capital',
  amount: '',
  date: new Date().toISOString().split('T')[0],
  description: '',
};

export default function Capital() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [capitalEntries, setCapitalEntries] = useState<CapitalEntry[]>([]);
  const [loans, setLoans] = useState<LoanTracker[]>([]);
  const [loanPayments, setLoanPayments] = useState<Transaction[]>([]);
  const [historicalProfit, setHistoricalProfit] = useState<HistoricalProfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCapital, setShowCapital] = useState(false);
  const [showLoanPayment, setShowLoanPayment] = useState(false);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showEditLoan, setShowEditLoan] = useState<string | null>(null);
  const [showHistorical, setShowHistorical] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<string>('');
  const [editingCapitalId, setEditingCapitalId] = useState<string | null>(null);
  const [editingHistoricalId, setEditingHistoricalId] = useState<string | null>(null);
  const [capitalForm, setCapitalForm] = useState<CapitalForm>(emptyCapital);
  const [loanPaymentForm, setLoanPaymentForm] = useState<LoanPaymentForm>({ amount: '', date: new Date().toISOString().split('T')[0], mode: 'cash', notes: '' });
  const [newLoanForm, setNewLoanForm] = useState({
    loanName: '',
    totalAmount: '',
    amountPaid: '0',
    monthlyInstallment: '',
    startDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [editLoanForm, setEditLoanForm] = useState({
    loanName: '',
    totalAmount: '',
    amountPaid: '',
    monthlyInstallment: '',
    startDate: '',
    notes: '',
  });
  const [historicalForm, setHistoricalForm] = useState({
    month: new Date().toISOString().slice(0, 7),
    totalProfit: '',
    taherShare: '',
    abdulqadirShare: '',
    taherTaken: '',
    abdulqadirTaken: '',
    notes: '',
  });
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  async function fetchData() {
    setLoading(true);
    const [{ data: cap }, { data: loanData }, { data: paymentData }, { data: hist }] = await Promise.all([
      supabase.from('capital_entries').select('*').order('date', { ascending: false }),
      supabase.from('loan_trackers').select('*'),
      supabase.from('transactions').select('*').eq('type', 'loan_payment').eq('is_void', false).order('date', { ascending: false }),
      supabase.from('historical_profit').select('*').order('month', { ascending: false }),
    ]);
    setCapitalEntries(cap || []);
    setLoans(loanData || []);
    setLoanPayments(paymentData || []);
    setHistoricalProfit(hist || []);
    setLoading(false);
  }

  function capitalDescription(form: CapitalForm) {
    return `Capital: ${form.entryType.replace(/_/g, ' ')} - ${form.partnerId}${form.description ? ' | ' + form.description : ''}`;
  }

  async function handleSaveCapital() {
    if (!capitalForm.amount || parseFloat(capitalForm.amount) <= 0) return;

    const { data: entry } = await supabase.from('capital_entries').insert({
      partner_id: capitalForm.partnerId,
      entry_type: capitalForm.entryType,
      amount: parseFloat(capitalForm.amount),
      date: capitalForm.date,
      description: capitalForm.description || null,
      created_by: user?.username || null,
    }).select().single();

    // Mirror into transactions so it shows up in Reports and the shared Ledger
    if (entry) {
      await supabase.from('transactions').insert({
        transaction_id: `CAP-${entry.id}`,
        date: entry.date,
        type: 'capital_entry',
        primary_mode: null,
        amount: entry.amount,
        partner_id: entry.partner_id,
        category: entry.entry_type,
        description: capitalDescription(capitalForm),
        notes: entry.description || null,
        created_by: user?.username || null,
      });
    }

    setCapitalForm({ ...emptyCapital, partnerId: user?.username === 'taher' ? 'taher' : user?.username === 'abdulqadir' ? 'abdulqadir' : 'taher' });
    setShowCapital(false);
    fetchData();
    triggerRefresh();
  }

  function startEditCapital(entry: CapitalEntry) {
    setEditingCapitalId(entry.id);
    setCapitalForm({
      partnerId: entry.partner_id,
      entryType: entry.entry_type,
      amount: String(entry.amount),
      date: entry.date,
      description: entry.description || '',
    });
    setShowCapital(true);
  }

  async function handleUpdateCapital() {
    if (!editingCapitalId || !capitalForm.amount || parseFloat(capitalForm.amount) <= 0) return;

    const payload = {
      partner_id: capitalForm.partnerId,
      entry_type: capitalForm.entryType,
      amount: parseFloat(capitalForm.amount),
      date: capitalForm.date,
      description: capitalForm.description || null,
    };

    await supabase.from('capital_entries').update(payload).eq('id', editingCapitalId);

    await supabase.from('transactions').update({
      date: payload.date,
      amount: payload.amount,
      partner_id: payload.partner_id,
      category: payload.entry_type,
      description: capitalDescription(capitalForm),
      notes: payload.description,
      edited_at: new Date().toISOString(),
    }).eq('transaction_id', `CAP-${editingCapitalId}`);

    setEditingCapitalId(null);
    setCapitalForm({ ...emptyCapital, partnerId: user?.username === 'taher' ? 'taher' : user?.username === 'abdulqadir' ? 'abdulqadir' : 'taher' });
    setShowCapital(false);
    fetchData();
    triggerRefresh();
  }

  async function handleDeleteCapital(id: string) {
    if (!confirm('Delete this capital entry? This cannot be undone.')) return;
    await supabase.from('transactions').update({ is_void: true, void_reason: 'Capital entry deleted' }).eq('transaction_id', `CAP-${id}`);
    await supabase.from('capital_entries').delete().eq('id', id);
    fetchData();
    triggerRefresh();
  }

  async function handleLoanPayment() {
    if (!selectedLoan || !loanPaymentForm.amount || parseFloat(loanPaymentForm.amount) <= 0) return;

    const amt = parseFloat(loanPaymentForm.amount);
    const loan = loans.find((l) => l.id === selectedLoan);
    if (!loan) return;

    // Create transaction record - Payment History below reads straight from
    // transactions, so this single insert is the only record that needs to
    // stay in sync when it's later edited or voided from the Expenses page
    const { data: newTxn, error } = await insertTransactionWithId('LOAN-' + loanPaymentForm.date.replace(/-/g, ''), (txnId) => ({
      transaction_id: txnId,
      date: loanPaymentForm.date,
      type: 'loan_payment',
      primary_mode: loanPaymentForm.mode as any,
      amount: amt,
      loan_id: selectedLoan,
      description: `Loan payment - ${loan.loan_name}`,
      notes: loanPaymentForm.notes || null,
      created_by: user?.username || null,
    }));
    if (error || !newTxn) { console.error(error); alert('Failed to save loan payment: ' + (error?.message || 'unknown error')); return; }

    await adjustLoanBalance(selectedLoan, amt);

    setLoanPaymentForm({ amount: '', date: todayStr(), mode: 'cash', notes: '' });
    setShowLoanPayment(false);
    fetchData();
    triggerRefresh();
  }

  async function handleAddLoan() {
    if (!newLoanForm.loanName || !newLoanForm.totalAmount) return;

    const total = parseFloat(newLoanForm.totalAmount);
    const paid = parseFloat(newLoanForm.amountPaid || '0');

    await supabase.from('loan_trackers').insert({
      loan_name: newLoanForm.loanName,
      loan_type: 'shop_loan',
      total_amount: total,
      remaining_balance: total - paid,
      amount_paid: paid,
      monthly_installment: newLoanForm.monthlyInstallment ? parseFloat(newLoanForm.monthlyInstallment) : null,
      start_date: newLoanForm.startDate,
      notes: newLoanForm.notes || null,
    });

    setNewLoanForm({
      loanName: '',
      totalAmount: '',
      amountPaid: '0',
      monthlyInstallment: '',
      startDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setShowAddLoan(false);
    fetchData();
    triggerRefresh();
  }

  async function handleEditLoan() {
    if (!showEditLoan) return;

    await supabase.from('loan_trackers').update({
      loan_name: editLoanForm.loanName,
      total_amount: parseFloat(editLoanForm.totalAmount),
      amount_paid: parseFloat(editLoanForm.amountPaid),
      remaining_balance: parseFloat(editLoanForm.totalAmount) - parseFloat(editLoanForm.amountPaid),
      monthly_installment: editLoanForm.monthlyInstallment ? parseFloat(editLoanForm.monthlyInstallment) : null,
      start_date: editLoanForm.startDate,
      notes: editLoanForm.notes || null,
    }).eq('id', showEditLoan);

    setShowEditLoan(null);
    fetchData();
    triggerRefresh();
  }

  async function handleDeleteLoan(id: string) {
    await supabase.from('loan_trackers').delete().eq('id', id);
    fetchData();
    triggerRefresh();
  }

  // Unlike Capital Entries, Historical Profit is deliberately never mirrored into
  // `transactions` - it's a backfilled record of months from before this app
  // existed, and mirroring it would double-count that profit against the live
  // transactions Reports/Dashboard already compute for the current period.
  async function handleSaveHistorical() {
    if (!historicalForm.month || !historicalForm.totalProfit) return;

    const totalProfit = parseFloat(historicalForm.totalProfit);
    const taherShare = parseFloat(historicalForm.taherShare || '0');
    const abdulqadirShare = parseFloat(historicalForm.abdulqadirShare || '0');
    const taherTaken = parseFloat(historicalForm.taherTaken || '0');
    const abdulqadirTaken = parseFloat(historicalForm.abdulqadirTaken || '0');
    const retained = totalProfit - taherShare - abdulqadirShare;

    await supabase.from('historical_profit').insert({
      month: historicalForm.month,
      total_profit: totalProfit,
      taher_share: taherShare,
      abdulqadir_share: abdulqadirShare,
      taher_taken: taherTaken,
      abdulqadir_taken: abdulqadirTaken,
      retained: retained,
      notes: historicalForm.notes || null,
      created_by: user?.username || null,
    });

    setHistoricalForm({
      month: new Date().toISOString().slice(0, 7),
      totalProfit: '',
      taherShare: '',
      abdulqadirShare: '',
      taherTaken: '',
      abdulqadirTaken: '',
      notes: '',
    });
    setShowHistorical(false);
    fetchData();
    triggerRefresh();
  }

  function startEditHistorical(h: HistoricalProfit) {
    setEditingHistoricalId(h.id);
    setHistoricalForm({
      month: h.month,
      totalProfit: String(h.total_profit),
      taherShare: String(h.taher_share ?? ''),
      abdulqadirShare: String(h.abdulqadir_share ?? ''),
      taherTaken: String(h.taher_taken ?? ''),
      abdulqadirTaken: String(h.abdulqadir_taken ?? ''),
      notes: h.notes || '',
    });
    setShowHistorical(true);
  }

  async function handleUpdateHistorical() {
    if (!editingHistoricalId || !historicalForm.month || !historicalForm.totalProfit) return;

    const totalProfit = parseFloat(historicalForm.totalProfit);
    const taherShare = parseFloat(historicalForm.taherShare || '0');
    const abdulqadirShare = parseFloat(historicalForm.abdulqadirShare || '0');
    const taherTaken = parseFloat(historicalForm.taherTaken || '0');
    const abdulqadirTaken = parseFloat(historicalForm.abdulqadirTaken || '0');
    const retained = totalProfit - taherShare - abdulqadirShare;

    await supabase.from('historical_profit').update({
      month: historicalForm.month,
      total_profit: totalProfit,
      taher_share: taherShare,
      abdulqadir_share: abdulqadirShare,
      taher_taken: taherTaken,
      abdulqadir_taken: abdulqadirTaken,
      retained: retained,
      notes: historicalForm.notes || null,
    }).eq('id', editingHistoricalId);

    setEditingHistoricalId(null);
    setHistoricalForm({
      month: todayStr().slice(0, 7),
      totalProfit: '',
      taherShare: '',
      abdulqadirShare: '',
      taherTaken: '',
      abdulqadirTaken: '',
      notes: '',
    });
    setShowHistorical(false);
    fetchData();
    triggerRefresh();
  }

  async function handleDeleteHistorical(id: string) {
    if (!confirm('Delete this historical profit record? This cannot be undone.')) return;
    await supabase.from('historical_profit').delete().eq('id', id);
    fetchData();
    triggerRefresh();
  }

  function startEditLoan(loan: LoanTracker) {
    setShowEditLoan(loan.id);
    setEditLoanForm({
      loanName: loan.loan_name,
      totalAmount: String(loan.total_amount),
      amountPaid: String(loan.amount_paid || 0),
      monthlyInstallment: loan.monthly_installment ? String(loan.monthly_installment) : '',
      startDate: loan.start_date || '',
      notes: loan.notes || '',
    });
  }

  function getLoanPayments(loanId: string) {
    return loanPayments.filter((p) => p.loan_id === loanId);
  }

  // Calculate partner summaries
  const taherCapital = capitalEntries
    .filter((c) => c.partner_id === 'taher')
    .reduce((s, c) => s + c.amount, 0);
  const abdulqadirCapital = capitalEntries
    .filter((c) => c.partner_id === 'abdulqadir')
    .reduce((s, c) => s + c.amount, 0);
  const totalCapital = taherCapital + abdulqadirCapital;

  const idrisLoan = loans.find((l) => l.loan_name.toLowerCase().includes('idris'));

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { setShowCapital(true); setEditingCapitalId(null); setCapitalForm({ ...emptyCapital, date: todayStr(), partnerId: user?.username === 'taher' ? 'taher' : user?.username === 'abdulqadir' ? 'abdulqadir' : 'taher' }); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> Add Capital Entry
        </button>
        <button onClick={() => { setShowLoanPayment(true); setLoanPaymentForm({ amount: '', date: todayStr(), mode: 'cash', notes: '' }); }} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> Loan Payment
        </button>
        <button onClick={() => { setShowAddLoan(true); setNewLoanForm({ loanName: '', totalAmount: '', amountPaid: '0', monthlyInstallment: '', startDate: todayStr(), notes: '' }); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> Add New Loan
        </button>
        <button onClick={() => { setShowHistorical(true); setEditingHistoricalId(null); setHistoricalForm({ month: todayStr().slice(0, 7), totalProfit: '', taherShare: '', abdulqadirShare: '', taherTaken: '', abdulqadirTaken: '', notes: '' }); }} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> Historical Profit
        </button>
        <button onClick={() => setShowLedger(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <BookOpen size={16} /> View Ledger
        </button>
      </div>

      {/* Capital Entry Modal */}
      {showCapital && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">{editingCapitalId ? 'Edit' : 'Add'} Capital Entry</h3>
            <button onClick={() => { setShowCapital(false); setEditingCapitalId(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <select value={capitalForm.partnerId} onChange={(e) => setCapitalForm({ ...capitalForm, partnerId: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="taher">Taher</option>
                <option value="abdulqadir">Abdulqadir</option>
              </select>
              <select value={capitalForm.entryType} onChange={(e) => setCapitalForm({ ...capitalForm, entryType: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="initial_capital">Initial</option>
                <option value="additional_investment">Addition</option>
                <option value="retained_profit">Retained</option>
              </select>
              <input type="number" value={capitalForm.amount} onChange={(e) => setCapitalForm({ ...capitalForm, amount: e.target.value })} placeholder="Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="date" value={capitalForm.date} onChange={(e) => setCapitalForm({ ...capitalForm, date: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <input type="text" value={capitalForm.description} onChange={(e) => setCapitalForm({ ...capitalForm, description: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (editingCapitalId ? handleUpdateCapital : handleSaveCapital)(); }}} placeholder="Description (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <div className="flex gap-2 pt-2 border-t border-slate-200">
              <button onClick={editingCapitalId ? handleUpdateCapital : handleSaveCapital} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium">{editingCapitalId ? 'Update' : 'Save'}</button>
              <button onClick={() => { setShowCapital(false); setEditingCapitalId(null); }} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Loan Payment Modal */}
      {showLoanPayment && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">Loan Payment</h3>
            <button onClick={() => setShowLoanPayment(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            <select value={selectedLoan} onChange={(e) => setSelectedLoan(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Select Loan</option>
              {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_name} ({formatKES(l.remaining_balance)})</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={loanPaymentForm.amount} onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, amount: e.target.value })} placeholder="Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="date" value={loanPaymentForm.date} onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, date: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <select value={loanPaymentForm.mode} onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, mode: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="cash">Cash</option>
                <option value="mpesa">Mpesa</option>
                <option value="paybill">Paybill</option>
              </select>
            </div>
            <input type="text" value={loanPaymentForm.notes} onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, notes: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLoanPayment(); }}} placeholder="Notes (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <button onClick={handleLoanPayment} className="w-full bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded text-sm font-medium">Pay Loan</button>
          </div>
        </div>
      )}

      {/* Add New Loan Modal */}
      {showAddLoan && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">Add New Loan</h3>
            <button onClick={() => setShowAddLoan(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={newLoanForm.loanName} onChange={(e) => setNewLoanForm({ ...newLoanForm, loanName: e.target.value })} placeholder="Loan Name" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="number" value={newLoanForm.totalAmount} onChange={(e) => setNewLoanForm({ ...newLoanForm, totalAmount: e.target.value })} placeholder="Total Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={newLoanForm.amountPaid} onChange={(e) => setNewLoanForm({ ...newLoanForm, amountPaid: e.target.value })} placeholder="Paid" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="number" value={newLoanForm.monthlyInstallment} onChange={(e) => setNewLoanForm({ ...newLoanForm, monthlyInstallment: e.target.value })} placeholder="Monthly" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="date" value={newLoanForm.startDate} onChange={(e) => setNewLoanForm({ ...newLoanForm, startDate: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <input type="text" value={newLoanForm.notes} onChange={(e) => setNewLoanForm({ ...newLoanForm, notes: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLoan(); }}} placeholder="Notes (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <button onClick={handleAddLoan} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded text-sm font-medium">Add Loan</button>
          </div>
        </div>
      )}

      {/* Edit Loan Modal */}
      {showEditLoan && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Edit Loan</h3>
              <button onClick={() => setShowEditLoan(null)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={editLoanForm.loanName} onChange={(e) => setEditLoanForm({ ...editLoanForm, loanName: e.target.value })} placeholder="Loan Name" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                <input type="number" value={editLoanForm.totalAmount} onChange={(e) => setEditLoanForm({ ...editLoanForm, totalAmount: e.target.value })} placeholder="Total" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" value={editLoanForm.amountPaid} onChange={(e) => setEditLoanForm({ ...editLoanForm, amountPaid: e.target.value })} placeholder="Paid" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                <input type="number" value={editLoanForm.monthlyInstallment} onChange={(e) => setEditLoanForm({ ...editLoanForm, monthlyInstallment: e.target.value })} placeholder="Monthly" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                <input type="date" value={editLoanForm.startDate} onChange={(e) => setEditLoanForm({ ...editLoanForm, startDate: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <input type="text" value={editLoanForm.notes} onChange={(e) => setEditLoanForm({ ...editLoanForm, notes: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditLoan(); }}} placeholder="Notes" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <div className="flex gap-2 pt-2 border-t border-slate-200">
                <button onClick={handleEditLoan} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium">Update</button>
                <button onClick={() => setShowEditLoan(null)} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical Profit Modal */}
      {showHistorical && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800 text-sm">{editingHistoricalId ? 'Edit' : 'Add'} Historical Profit</h3>
            <button onClick={() => { setShowHistorical(false); setEditingHistoricalId(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input type="month" value={historicalForm.month} onChange={(e) => setHistoricalForm({ ...historicalForm, month: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="number" value={historicalForm.totalProfit} onChange={(e) => setHistoricalForm({ ...historicalForm, totalProfit: e.target.value })} placeholder="Total Profit" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={historicalForm.taherShare} onChange={(e) => setHistoricalForm({ ...historicalForm, taherShare: e.target.value })} placeholder="Taher Share" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="number" value={historicalForm.abdulqadirShare} onChange={(e) => setHistoricalForm({ ...historicalForm, abdulqadirShare: e.target.value })} placeholder="Abdul Share" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={historicalForm.taherTaken} onChange={(e) => setHistoricalForm({ ...historicalForm, taherTaken: e.target.value })} placeholder="Taher Taken" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <input type="number" value={historicalForm.abdulqadirTaken} onChange={(e) => setHistoricalForm({ ...historicalForm, abdulqadirTaken: e.target.value })} placeholder="Abdul Taken" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <input type="text" value={historicalForm.notes} onChange={(e) => setHistoricalForm({ ...historicalForm, notes: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (editingHistoricalId ? handleUpdateHistorical : handleSaveHistorical)(); }}} placeholder="Notes (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <button onClick={editingHistoricalId ? handleUpdateHistorical : handleSaveHistorical} className="w-full bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded text-sm font-medium">{editingHistoricalId ? 'Update' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* Capital Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={18} className="text-emerald-500" />
            <h3 className="font-semibold text-slate-800">Taher Capital</h3>
          </div>
          <p className="text-2xl font-bold text-emerald-600">KES {formatKES(taherCapital)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={18} className="text-blue-500" />
            <h3 className="font-semibold text-slate-800">Abdulqadir Capital</h3>
          </div>
          <p className="text-2xl font-bold text-blue-600">KES {formatKES(abdulqadirCapital)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Landmark size={18} className="text-amber-500" />
            <h3 className="font-semibold text-slate-800">Total Capital</h3>
          </div>
          <p className="text-2xl font-bold text-amber-600">KES {formatKES(totalCapital)}</p>
        </div>
      </div>

      {/* Capital History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-500" />
          <h3 className="font-semibold text-slate-800">Capital History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Partner</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {capitalEntries.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No capital entries</td></tr>
              ) : (
                capitalEntries.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 text-slate-600">{formatDate(c.date)}</td>
                    <td className="px-4 py-2 capitalize font-medium text-slate-800">{c.partner_id}</td>
                    <td className="px-4 py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{c.entry_type.replace('_', ' ')}</span></td>
                    <td className="px-4 py-2 text-right font-medium">{formatKES(c.amount)}</td>
                    <td className="px-4 py-2 text-slate-500">
                      {c.description || '-'}
                      {c.created_by && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Added by">
                          {c.created_by}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEditCapital(c)} className="p-1 hover:bg-slate-200 rounded"><Edit2 size={14} className="text-slate-500" /></button>
                        <button onClick={() => handleDeleteCapital(c.id)} className="p-1 hover:bg-red-100 rounded"><Trash2 size={14} className="text-red-500" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Idris Loan Tracker */}
      {idrisLoan && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Landmark size={18} className="text-amber-500" />
            <h3 className="font-semibold text-slate-800">Idris Loan Tracker</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">Total Amount</p>
              <p className="text-lg font-bold">KES {formatKES(idrisLoan.total_amount)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">Amount Paid</p>
              <p className="text-lg font-bold text-emerald-600">KES {formatKES(idrisLoan.amount_paid || 0)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">Remaining</p>
              <p className="text-lg font-bold text-red-600">KES {formatKES(idrisLoan.remaining_balance)}</p>
            </div>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3">
            <div
              className="bg-emerald-500 h-3 rounded-full transition-all"
              style={{ width: `${idrisLoan.total_amount > 0 ? Math.min(100, ((idrisLoan.total_amount - idrisLoan.remaining_balance) / idrisLoan.total_amount) * 100) : 0}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1 text-right">
            {idrisLoan.total_amount > 0 ? ((idrisLoan.total_amount - idrisLoan.remaining_balance) / idrisLoan.total_amount * 100).toFixed(1) : '0.0'}% paid
          </p>
        </div>
      )}

      {/* All Loans */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">All Loans</h3>
          <span className="text-sm text-slate-500">{loans.length} active</span>
        </div>
        <div className="p-4">
          {loans.length === 0 ? (
            <div className="text-center text-slate-400 py-8">No loans</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {loans.map((loan) => {
                const progress = loan.total_amount > 0 ? Math.min(100, ((loan.total_amount - loan.remaining_balance) / loan.total_amount) * 100) : 0;
                const payments = getLoanPayments(loan.id);
                return (
                  <div key={loan.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-slate-800">{loan.loan_name}</h4>
                      <div className="flex gap-1">
                        <button onClick={() => startEditLoan(loan)} className="p-1 hover:bg-slate-100 rounded"><Edit2 size={12} className="text-slate-500" /></button>
                        <button onClick={() => { if (confirm('Delete this loan?')) handleDeleteLoan(loan.id); }} className="p-1 hover:bg-red-100 rounded"><Trash2 size={12} className="text-red-500" /></button>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Total:</span><span className="font-medium">KES {formatKES(loan.total_amount)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Paid:</span><span className="font-medium text-emerald-600">KES {formatKES(loan.amount_paid || 0)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Remaining:</span><span className="font-medium text-red-600">KES {formatKES(loan.remaining_balance)}</span></div>
                      {loan.monthly_installment && (
                        <div className="flex justify-between"><span className="text-slate-500">Monthly:</span><span className="font-medium">KES {formatKES(loan.monthly_installment)}</span></div>
                      )}
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2 mt-3">
                      <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-xs text-slate-500 mt-1 text-right">{progress.toFixed(1)}% paid</p>
                    {payments.length > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-2">
                        <p className="text-xs text-slate-500 mb-1">Payment History:</p>
                        <div className="space-y-1">
                          {payments.slice(0, 3).map((p) => (
                            <div key={p.id} className="flex justify-between text-xs">
                              <span className="text-slate-500">{formatDate(p.date)}</span>
                              <span className="font-medium">{formatKES(p.amount)}</span>
                            </div>
                          ))}
                          {payments.length > 3 && <p className="text-xs text-slate-400">+{payments.length - 3} more</p>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Historical Profit */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-500" />
          <h3 className="font-semibold text-slate-800">Historical Profit</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Total Profit</th>
                <th className="px-4 py-2 text-right">Taher Share</th>
                <th className="px-4 py-2 text-right">Abdulqadir Share</th>
                <th className="px-4 py-2 text-right">Taher Taken</th>
                <th className="px-4 py-2 text-right">Abdulqadir Taken</th>
                <th className="px-4 py-2 text-right">Retained</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historicalProfit.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No historical data</td></tr>
              ) : (
                historicalProfit.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 font-medium">
                      {getMonthLabel(h.month)}
                      {h.created_by && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-normal" title="Added by">
                          {h.created_by}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{formatKES(h.total_profit)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.taher_share || 0)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.abdulqadir_share || 0)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.taher_taken)}</td>
                    <td className="px-4 py-2 text-right">{formatKES(h.abdulqadir_taken)}</td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-600">{formatKES(h.retained || 0)}</td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEditHistorical(h)} className="p-1 hover:bg-slate-200 rounded"><Edit2 size={14} className="text-slate-500" /></button>
                        <button onClick={() => handleDeleteHistorical(h.id)} className="p-1 hover:bg-red-100 rounded"><Trash2 size={14} className="text-red-500" /></button>
                      </div>
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
        title="Capital & Loans Ledger"
        filterTypes={['capital_entry', 'loan_payment']}
      />
    </div>
  );
}