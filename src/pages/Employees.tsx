import { useEffect, useState, Fragment } from 'react';
import { Plus, Search, X, Edit2, Trash2, BookOpen } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, formatTime, todayStr } from '../utils/format';
import { fetchAllRows } from '../utils/fetchAll';
import {
  calculateEmployeeLoans,
  calculateEmployeeAdvances,
  calculateEmployeeTotals,
  saveEmployeeSalaryPayment,
  giveEmployeeLoan,
  giveEmployeeAdvance,
  voidEmployeeTransaction,
} from '../utils/employeePay';
import EmployeeSalaryFields, { emptySalaryForm, salaryTotal, SalaryForm } from '../components/EmployeeSalaryFields';
import BulkSalaryModal from '../components/BulkSalaryModal';
import { useDataRefresh } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { usePersistentState } from '../context/PageStateContext';
import { useSaveGuard } from '../utils/useSaveGuard';
import { handleFormKeyNav } from '../utils/formKeyNav';
import LedgerModal from '../components/LedgerModal';
import DateFilterBar from '../components/DateFilterBar';
import { getDatePresetRange, DatePreset } from '../utils/dateFilters';
import type { Employee, Transaction } from '../types';

interface EmployeeForm {
  name: string;
  phone: string;
  monthlySalary: string;
  weeklySalary: string;
  notes: string;
}

const emptyEmployee: EmployeeForm = { name: '', phone: '', monthlySalary: '', weeklySalary: '', notes: '' };

interface LoanAdvanceForm {
  date: string;
  amount: string;
  mode: string;
  notes: string;
  noRealCash: boolean;
}

const emptyLoanAdvance = (): LoanAdvanceForm => ({ date: todayStr(), amount: '', mode: 'cash', notes: '', noRealCash: false });

export default function Employees() {
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const { saving: savingEmployee, guard: guardEmployee } = useSaveGuard();
  const { saving: savingLoan, guard: guardLoan } = useSaveGuard();
  const { saving: savingAdvance, guard: guardAdvance } = useSaveGuard();
  const [search, setSearch] = usePersistentState('employees.search', '');
  const [selectedEmployee, setSelectedEmployee] = usePersistentState<Employee | null>('employees.selectedEmployee', null);
  const [editingId, setEditingId] = usePersistentState<string | null>('employees.editingId', null);
  const [showAdd, setShowAdd] = usePersistentState('employees.showAdd', false);
  const [form, setForm] = usePersistentState<EmployeeForm>('employees.form', emptyEmployee);
  const [showSalary, setShowSalary] = usePersistentState('employees.showSalary', false);
  const [showBulkSalary, setShowBulkSalary] = useState(false);
  const [salaryForm, setSalaryForm] = usePersistentState<SalaryForm>('employees.salaryForm', () => emptySalaryForm(todayStr()));
  const [savingSalary, setSavingSalary] = useState(false);
  const [showLoan, setShowLoan] = usePersistentState('employees.showLoan', false);
  const [loanForm, setLoanForm] = usePersistentState<LoanAdvanceForm>('employees.loanForm', emptyLoanAdvance);
  const [showAdvance, setShowAdvance] = usePersistentState('employees.showAdvance', false);
  const [advanceForm, setAdvanceForm] = usePersistentState<LoanAdvanceForm>('employees.advanceForm', emptyLoanAdvance);
  const [showLedger, setShowLedger] = useState(false);
  const [txnDatePreset, setTxnDatePreset] = usePersistentState<DatePreset>('employees.txnDatePreset', 'month');
  const [txnCustomFrom, setTxnCustomFrom] = usePersistentState('employees.txnCustomFrom', '');
  const [txnCustomTo, setTxnCustomTo] = usePersistentState('employees.txnCustomTo', '');
  const [editingTxnId, setEditingTxnId] = usePersistentState<string | null>('employees.editingTxnId', null);
  const [txnEditForm, setTxnEditForm] = usePersistentState('employees.txnEditForm', { date: '', amount: '', mode: 'cash', notes: '' });

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  useEffect(() => {
    if (selectedEmployee) {
      const updated = employees.find((e) => e.id === selectedEmployee.id);
      if (updated) setSelectedEmployee(updated);
    }
  }, [employees]);

  async function fetchData() {
    setLoading(true);
    const [{ data: emps }, { data: txns }] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      fetchAllRows<Transaction>((from, to) =>
        supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }).range(from, to)
      ),
    ]);
    setEmployees(emps || []);
    setTransactions(txns || []);
    setLoading(false);
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      name: emp.name,
      phone: emp.phone || '',
      monthlySalary: String(emp.monthly_salary ?? ''),
      weeklySalary: String(emp.weekly_salary ?? ''),
      notes: emp.notes || '',
    });
    setShowAdd(true);
  }

  async function handleSaveEmployee() {
    const name = form.name.trim();
    if (!name) return;
    if (!editingId && employees.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      alert('An employee with this name already exists.');
      return;
    }

    const payload = {
      name,
      phone: form.phone || null,
      monthly_salary: form.monthlySalary ? parseFloat(form.monthlySalary) : null,
      weekly_salary: form.weeklySalary ? parseFloat(form.weeklySalary) : null,
      notes: form.notes || null,
    };

    if (editingId) {
      await supabase.from('employees').update(payload).eq('id', editingId);
    } else {
      await supabase.from('employees').insert(payload);
    }

    setForm(emptyEmployee);
    setShowAdd(false);
    setEditingId(null);
    fetchData();
    triggerRefresh();
  }

  async function handleRemoveEmployee(emp: Employee) {
    if (!confirm(`Remove ${emp.name}? Their history stays intact, they'll just stop showing up as active.`)) return;
    await supabase.from('employees').update({ is_active: false }).eq('id', emp.id);
    if (selectedEmployee?.id === emp.id) setSelectedEmployee(null);
    fetchData();
    triggerRefresh();
  }

  function openSalaryForm(emp: Employee) {
    setSalaryForm({ ...emptySalaryForm(todayStr()), employeeId: emp.id, amount: emp.weekly_salary ? String(emp.weekly_salary) : '' });
    setShowSalary(true);
  }

  async function handleSaveSalary() {
    if (savingSalary) return;
    const emp = employees.find((e) => e.id === salaryForm.employeeId);
    if (!emp) { alert('Pick an employee'); return; }
    const total = salaryTotal(salaryForm);
    if (total < 0) { alert('Loan/advance deductions add up to more than the salary and commission.'); return; }

    setSavingSalary(true);
    try {
      const loans = calculateEmployeeLoans(transactions, emp.id);
      const activeLoan = loans.find((l) => l.remaining > 0);
      const advances = calculateEmployeeAdvances(transactions, emp.id);
      const activeAdvance = advances.find((a) => a.remaining > 0);

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
      setShowSalary(false);
      fetchData();
      triggerRefresh();
    } finally {
      setSavingSalary(false);
    }
  }

  async function handleGiveLoan() {
    if (!selectedEmployee || !loanForm.amount || parseFloat(loanForm.amount) <= 0) return;
    const { error } = await giveEmployeeLoan(selectedEmployee.id, loanForm.date, parseFloat(loanForm.amount), loanForm.mode, loanForm.notes || null, user?.username || null, loanForm.noRealCash);
    if (error) { alert('Failed to save loan: ' + error.message); return; }
    setLoanForm(emptyLoanAdvance());
    setShowLoan(false);
    fetchData();
    triggerRefresh();
  }

  async function handleGiveAdvance() {
    if (!selectedEmployee || !advanceForm.amount || parseFloat(advanceForm.amount) <= 0) return;
    const { error } = await giveEmployeeAdvance(selectedEmployee.id, advanceForm.date, parseFloat(advanceForm.amount), advanceForm.mode, advanceForm.notes || null, user?.username || null, advanceForm.noRealCash);
    if (error) { alert('Failed to save advance: ' + error.message); return; }
    setAdvanceForm(emptyLoanAdvance());
    setShowAdvance(false);
    fetchData();
    triggerRefresh();
  }

  async function handleVoidTxn(t: Transaction) {
    if (!confirm('Void this entry?')) return;
    const result = await voidEmployeeTransaction(t.id);
    if (!result.ok) { alert(result.error); return; }
    fetchData();
    triggerRefresh();
  }

  function startEditTxn(t: Transaction) {
    setEditingTxnId(t.id);
    setTxnEditForm({ date: t.date, amount: String(t.amount || ''), mode: t.primary_mode || 'cash', notes: t.notes || '' });
  }

  async function handleUpdateTxn() {
    if (!editingTxnId) return;
    const txn = transactions.find((t) => t.id === editingTxnId);
    if (!txn) return;
    const newAmount = parseFloat(txnEditForm.amount);
    if (!txnEditForm.amount || isNaN(newAmount) || newAmount <= 0) { alert('Enter a valid amount greater than 0'); return; }
    const { error } = await supabase.from('transactions').update({
      date: txnEditForm.date,
      amount: newAmount,
      // For a salary payment, primary_mode is derived from whether the net
      // amount is positive (see saveEmployeeSalaryPayment) - editing the
      // amount here must re-derive it the same way, or a payment that was
      // originally fully absorbed by a loan/advance deduction (net 0,
      // primary_mode null) would silently never touch the wallet once
      // corrected to a real positive amount. A loan/advance's mode is a
      // one-time choice made when it was given (or deliberately null for a
      // historical "don't touch wallet" entry) - editing its amount later
      // must not change that choice.
      ...(txn.type === 'employee_salary' ? { primary_mode: newAmount > 0 ? txnEditForm.mode : null } : {}),
      notes: txnEditForm.notes || null,
      edited_at: new Date().toISOString(),
    }).eq('id', editingTxnId);
    if (error) { alert('Failed to save: ' + error.message); return; }
    setEditingTxnId(null);
    fetchData();
    triggerRefresh();
  }

  function getEmployeeTransactions(employeeId: string) {
    const { from, to } = getDatePresetRange(txnDatePreset, txnCustomFrom, txnCustomTo);
    return transactions.filter((t) => t.employee_id === employeeId && t.date >= from && t.date <= to);
  }

  const filteredEmployees = employees.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()) || (e.phone || '').includes(search));

  const typeLabel: Record<string, string> = {
    employee_salary: 'Salary',
    employee_loan: 'Loan given',
    employee_advance: 'Advance given',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-800">Employees</h2>
        <div className="flex gap-2">
          <button onClick={() => { setShowAdd(true); setEditingId(null); setForm(emptyEmployee); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <Plus size={16} /> Add Employee
          </button>
          <button onClick={() => setShowBulkSalary(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <Plus size={16} /> Bulk Pay Salaries
          </button>
          <button onClick={() => setShowLedger(true)} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <BookOpen size={16} /> View Ledger
          </button>
          {loading && <span className="text-xs text-slate-400 self-center">Loading...</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Employee List */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-1">
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees..."
                className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-slate-400">Loading...</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No employees found</div>
            ) : (
              filteredEmployees.map((emp) => {
                const totals = calculateEmployeeTotals(transactions, emp.id);
                return (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmployee(emp)}
                  className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors ${
                    selectedEmployee?.id === emp.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''
                  }`}
                >
                  <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-medium uppercase text-slate-600">
                    {emp.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{emp.name}</p>
                    <p className="text-xs text-slate-500">{emp.phone || 'No phone'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {totals.totalLoanOutstanding > 0 && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Loan: {formatKES(totals.totalLoanOutstanding)}</span>
                    )}
                    {totals.totalAdvanceOutstanding > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Adv: {formatKES(totals.totalAdvanceOutstanding)}</span>
                    )}
                  </div>
                </button>
                );
              })
            )}
          </div>
        </div>

        {/* Employee Detail */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          {selectedEmployee ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-sm font-medium uppercase text-emerald-700">
                    {selectedEmployee.name[0]}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">{selectedEmployee.name}</h3>
                    <p className="text-xs text-slate-500">{selectedEmployee.phone || 'No phone'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(selectedEmployee)} className="p-1.5 hover:bg-slate-100 rounded"><Edit2 size={14} className="text-slate-500" /></button>
                  <button onClick={() => handleRemoveEmployee(selectedEmployee)} className="p-1.5 hover:bg-red-100 rounded"><Trash2 size={14} className="text-red-500" /></button>
                  <button onClick={() => setShowLoan(true)} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add Loan</button>
                  <button onClick={() => setShowAdvance(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Give Advance</button>
                  <button onClick={() => openSalaryForm(selectedEmployee)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Pay Salary</button>
                </div>
              </div>

              {/* Summary */}
              {(() => {
                const totals = calculateEmployeeTotals(transactions, selectedEmployee.id);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="rounded-lg p-3 border bg-slate-50 border-slate-200">
                      <p className="text-xs text-slate-500">Salary Paid</p>
                      <p className="text-lg font-bold text-slate-700">KES {formatKES(totals.totalSalaryPaid)}</p>
                    </div>
                    <div className="rounded-lg p-3 border bg-slate-50 border-slate-200">
                      <p className="text-xs text-slate-500">Commission Paid</p>
                      <p className="text-lg font-bold text-slate-700">KES {formatKES(totals.totalCommissionPaid)}</p>
                    </div>
                    <div className="rounded-lg p-3 border bg-amber-50 border-amber-100">
                      <p className="text-xs text-amber-600">Loan Outstanding</p>
                      <p className="text-lg font-bold text-amber-700">KES {formatKES(totals.totalLoanOutstanding)}</p>
                    </div>
                    <div className="rounded-lg p-3 border bg-blue-50 border-blue-100">
                      <p className="text-xs text-blue-600">Advance Outstanding</p>
                      <p className="text-lg font-bold text-blue-700">KES {formatKES(totals.totalAdvanceOutstanding)}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Loan section */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Loans</h4>
                {calculateEmployeeLoans(transactions, selectedEmployee.id).length === 0 ? (
                  <p className="text-xs text-slate-400">No loans given.</p>
                ) : (
                  <div className="space-y-1">
                    {calculateEmployeeLoans(transactions, selectedEmployee.id).map((l) => (
                      <div key={l.transactionId} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5">
                        <span className="text-slate-500">{formatDate(l.date)} - {l.notes || 'Loan'}</span>
                        <span className="text-slate-700">Given KES {formatKES(l.amount)} · Deducted KES {formatKES(l.deducted)}</span>
                        <span className={`font-medium ${l.remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>Remaining KES {formatKES(l.remaining)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Advance section */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Advances</h4>
                {calculateEmployeeAdvances(transactions, selectedEmployee.id).length === 0 ? (
                  <p className="text-xs text-slate-400">No advances given.</p>
                ) : (
                  <div className="space-y-1">
                    {calculateEmployeeAdvances(transactions, selectedEmployee.id).map((a) => (
                      <div key={a.transactionId} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5">
                        <span className="text-slate-500">{formatDate(a.date)} - {a.notes || 'Advance'}</span>
                        <span className="text-slate-700">Given KES {formatKES(a.amount)} · Deducted KES {formatKES(a.deducted)}</span>
                        <span className={`font-medium ${a.remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>Remaining KES {formatKES(a.remaining)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Transaction History */}
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h4 className="text-sm font-semibold text-slate-700">Transaction History</h4>
                <DateFilterBar
                  preset={txnDatePreset}
                  customFrom={txnCustomFrom}
                  customTo={txnCustomTo}
                  onChange={(p, from, to) => { setTxnDatePreset(p); setTxnCustomFrom(from); setTxnCustomTo(to); }}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Details</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getEmployeeTransactions(selectedEmployee.id).length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400 text-xs">No transactions</td></tr>
                    ) : (
                      getEmployeeTransactions(selectedEmployee.id).map((t) => (
                        <Fragment key={t.id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 text-slate-600">
                            {formatDate(t.date)}
                            <span className="block text-xs text-slate-400">{formatTime(t.created_at)}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{typeLabel[t.type] || t.type}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-700 text-xs">
                            {t.type === 'employee_salary' && (
                              <>
                                {t.commission ? `Commission KES ${formatKES(t.commission)}. ` : ''}
                                {t.employee_loan_deduction ? `Loan deducted KES ${formatKES(t.employee_loan_deduction)}. ` : ''}
                                {t.employee_advance_deduction ? `Advance deducted KES ${formatKES(t.employee_advance_deduction)}. ` : ''}
                                {t.days_worked ? `${t.days_worked} days worked. ` : ''}
                              </>
                            )}
                            {t.notes || t.description || '-'}
                            {t.edited_at && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Edited</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-800">KES {formatKES(t.amount)}</td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => startEditTxn(t)} className="p-1 hover:bg-slate-200 rounded"><Edit2 size={14} className="text-slate-500" /></button>
                              <button onClick={() => handleVoidTxn(t)} className="p-1 hover:bg-red-100 rounded"><Trash2 size={14} className="text-red-500" /></button>
                            </div>
                          </td>
                        </tr>
                        {editingTxnId === t.id && (
                          <tr>
                            <td colSpan={5} className="px-3 py-3 bg-slate-50">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <input type="date" value={txnEditForm.date} onChange={(e) => setTxnEditForm({ ...txnEditForm, date: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                <input type="number" min="0" value={txnEditForm.amount} onChange={(e) => setTxnEditForm({ ...txnEditForm, amount: e.target.value })} placeholder="Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                {t.type === 'employee_salary' && (
                                  <select value={txnEditForm.mode} onChange={(e) => setTxnEditForm({ ...txnEditForm, mode: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                                    <option value="cash">Cash</option>
                                    <option value="mpesa">Mpesa</option>
                                    <option value="paybill">Paybill</option>
                                  </select>
                                )}
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
          ) : (
            <div className="p-8 text-center text-slate-400">Select an employee to view details</div>
          )}
        </div>
      </div>

      {/* Add/Edit Employee Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') { setShowAdd(false); setEditingId(null); } }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">{editingId ? 'Edit' : 'Add'} Employee</h3>
              <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} placeholder="Name" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} placeholder="Phone (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min="0" value={form.weeklySalary} onChange={(e) => setForm({ ...form, weeklySalary: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} placeholder="Weekly salary" className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                <input type="number" min="0" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} placeholder="Monthly salary" className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e, handleSaveEmployee)} placeholder="Notes (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              <div className="flex gap-2">
                <button onClick={guardEmployee(handleSaveEmployee)} disabled={savingEmployee} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">{savingEmployee ? 'Saving...' : 'Save'}</button>
                <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Loan Modal */}
      {showLoan && selectedEmployee && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setShowLoan(false); }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Add Loan - {selectedEmployee.name}</h3>
              <button onClick={() => setShowLoan(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={loanForm.date} onChange={(e) => setLoanForm({ ...loanForm, date: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                <input type="number" min="0" value={loanForm.amount} onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} placeholder="Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <select value={loanForm.mode} onChange={(e) => setLoanForm({ ...loanForm, mode: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="cash">Cash</option>
                <option value="mpesa">Mpesa</option>
                <option value="paybill">Paybill</option>
              </select>
              <input type="text" value={loanForm.notes} onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e, handleGiveLoan)} placeholder="Reason / notes (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={loanForm.noRealCash} onChange={(e) => setLoanForm({ ...loanForm, noRealCash: e.target.checked })} onKeyDown={(e) => handleFormKeyNav(e)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                This already happened before (e.g. an old loan) - don't deduct from wallet balance
              </label>
              <button onClick={guardLoan(handleGiveLoan)} disabled={savingLoan} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">{savingLoan ? 'Saving...' : 'Save Loan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Give Advance Modal */}
      {showAdvance && selectedEmployee && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setShowAdvance(false); }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Give Advance - {selectedEmployee.name}</h3>
              <button onClick={() => setShowAdvance(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={advanceForm.date} onChange={(e) => setAdvanceForm({ ...advanceForm, date: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                <input type="number" min="0" value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} placeholder="Amount" className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <select value={advanceForm.mode} onChange={(e) => setAdvanceForm({ ...advanceForm, mode: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="cash">Cash</option>
                <option value="mpesa">Mpesa</option>
                <option value="paybill">Paybill</option>
              </select>
              <input type="text" value={advanceForm.notes} onChange={(e) => setAdvanceForm({ ...advanceForm, notes: e.target.value })} onKeyDown={(e) => handleFormKeyNav(e, handleGiveAdvance)} placeholder="Notes (optional)" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={advanceForm.noRealCash} onChange={(e) => setAdvanceForm({ ...advanceForm, noRealCash: e.target.checked })} onKeyDown={(e) => handleFormKeyNav(e)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                This already happened before (e.g. an old advance) - don't deduct from wallet balance
              </label>
              <button onClick={guardAdvance(handleGiveAdvance)} disabled={savingAdvance} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">{savingAdvance ? 'Saving...' : 'Save Advance'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Salary Modal */}
      {showSalary && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setShowSalary(false); }}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md max-h-[90vh] overflow-y-auto" data-form-nav>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">Pay Salary</h3>
              <button onClick={() => setShowSalary(false)} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>
            <EmployeeSalaryFields employees={employees} transactions={transactions} form={salaryForm} onChange={setSalaryForm} />
            <button onClick={handleSaveSalary} disabled={savingSalary} className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">
              {savingSalary ? 'Saving...' : 'Save Payment'}
            </button>
          </div>
        </div>
      )}

      {showBulkSalary && (
        <BulkSalaryModal
          employees={employees}
          transactions={transactions}
          createdBy={user?.username || null}
          onClose={() => setShowBulkSalary(false)}
          onSaved={() => { setShowBulkSalary(false); fetchData(); triggerRefresh(); }}
        />
      )}

      <LedgerModal
        open={showLedger}
        onClose={() => setShowLedger(false)}
        title="Employees Ledger"
        filterTypes={['employee_salary', 'employee_loan', 'employee_advance']}
      />
    </div>
  );
}
