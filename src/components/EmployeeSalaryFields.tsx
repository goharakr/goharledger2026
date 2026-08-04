import { formatKES } from '../utils/format';
import { calculateEmployeeLoans, calculateEmployeeAdvances, autoFillSalaryAmount } from '../utils/employeePay';
import type { Employee, Transaction } from '../types';

export interface SalaryForm {
  employeeId: string;
  date: string;
  period: 'week' | 'month' | 'custom';
  customDays: string;
  amount: string;
  commission: string;
  loanDeduction: string;
  advanceDeduction: string;
  daysWorked: string;
  mode: string;
  notes: string;
}

export const emptySalaryForm = (date: string): SalaryForm => ({
  employeeId: '',
  date,
  period: 'week',
  customDays: '',
  amount: '',
  commission: '',
  loanDeduction: '',
  advanceDeduction: '',
  daysWorked: '',
  mode: 'cash',
  notes: '',
});

export function salaryTotal(form: SalaryForm): number {
  const amount = parseFloat(form.amount || '0') || 0;
  const commission = parseFloat(form.commission || '0') || 0;
  const loanDeduction = parseFloat(form.loanDeduction || '0') || 0;
  const advanceDeduction = parseFloat(form.advanceDeduction || '0') || 0;
  return amount + commission - loanDeduction - advanceDeduction;
}

interface Props {
  employees: Employee[];
  transactions: Transaction[];
  form: SalaryForm;
  onChange: (next: SalaryForm) => void;
  showEmployeePicker?: boolean;
}

// Shared by the Employees page (employee already picked) and the Expenses
// page's Employees tab (employee picker included) - one form, one set of
// rules, so the two entry points can never quietly drift apart.
export default function EmployeeSalaryFields({ employees, transactions, form, onChange, showEmployeePicker }: Props) {
  const employee = employees.find((e) => e.id === form.employeeId);
  const activeLoan = employee ? calculateEmployeeLoans(transactions, employee.id).find((l) => l.remaining > 0) : undefined;
  const activeAdvance = employee ? calculateEmployeeAdvances(transactions, employee.id).find((a) => a.remaining > 0) : undefined;

  function applyPeriod(period: SalaryForm['period'], customDays: string, employeeId: string) {
    const emp = employees.find((e) => e.id === employeeId);
    const amount = autoFillSalaryAmount(period, customDays, emp?.weekly_salary ?? null, emp?.monthly_salary ?? null);
    onChange({ ...form, employeeId, period, customDays, amount: amount > 0 ? String(amount) : form.amount });
  }

  return (
    <div className="space-y-2">
      {showEmployeePicker && (
        <select
          value={form.employeeId}
          onChange={(e) => applyPeriod(form.period, form.customDays, e.target.value)}
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="">Employee</option>
          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <input
          type="date"
          value={form.date}
          onChange={(e) => onChange({ ...form, date: e.target.value })}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <select
          value={form.period}
          onChange={(e) => applyPeriod(e.target.value as SalaryForm['period'], form.customDays, form.employeeId)}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="week">Weekly pay</option>
          <option value="month">Monthly pay</option>
          <option value="custom">Custom days</option>
        </select>
        {form.period === 'custom' ? (
          <input
            type="number"
            min="0"
            value={form.customDays}
            onChange={(e) => applyPeriod('custom', e.target.value, form.employeeId)}
            placeholder="No. of days"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        ) : <div />}
      </div>

      <input
        type="number"
        min="0"
        value={form.amount}
        onChange={(e) => onChange({ ...form, amount: e.target.value })}
        placeholder="Salary amount"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
      />

      <input
        type="number"
        min="0"
        value={form.commission}
        onChange={(e) => onChange({ ...form, commission: e.target.value })}
        placeholder="Commission (optional, adds to total)"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
      />

      {form.employeeId && (
        <div className="border border-amber-200 bg-amber-50 rounded p-2 space-y-1">
          <label className="text-xs text-slate-600 block">
            Loan deduction {activeLoan ? <span className="text-slate-400">(KES {formatKES(activeLoan.remaining)} remaining)</span> : <span className="text-slate-400">(no active loan - typing an amount records a new one, given and deducted today)</span>}
            <input
              type="number"
              min="0"
              value={form.loanDeduction}
              onChange={(e) => onChange({ ...form, loanDeduction: e.target.value })}
              placeholder="0"
              className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </label>
          <label className="text-xs text-slate-600 block">
            Advance deduction {activeAdvance ? <span className="text-slate-400">(KES {formatKES(activeAdvance.remaining)} remaining)</span> : <span className="text-slate-400">(no active advance - typing an amount records a new one, given and deducted today)</span>}
            <input
              type="number"
              min="0"
              value={form.advanceDeduction}
              onChange={(e) => onChange({ ...form, advanceDeduction: e.target.value })}
              placeholder="0"
              className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <input
          type="number"
          min="0"
          value={form.daysWorked}
          onChange={(e) => onChange({ ...form, daysWorked: e.target.value })}
          placeholder="Days worked (optional)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <select
          value={form.mode}
          onChange={(e) => onChange({ ...form, mode: e.target.value })}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          <option value="cash">Cash</option>
          <option value="mpesa">Mpesa</option>
          <option value="paybill">Paybill</option>
        </select>
        <div />
      </div>

      <input
        type="text"
        value={form.notes}
        onChange={(e) => onChange({ ...form, notes: e.target.value })}
        placeholder="Notes (optional)"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
      />

      <p className="text-sm font-medium text-slate-700">
        Total to pay: <span className={salaryTotal(form) < 0 ? 'text-red-600' : 'text-emerald-600'}>KES {formatKES(salaryTotal(form))}</span>
      </p>
    </div>
  );
}
