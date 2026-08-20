import { useState } from 'react';
import { X } from 'lucide-react';
import { formatKES, todayStr } from '../utils/format';
import { calculateEmployeeLoans, calculateEmployeeAdvances, saveEmployeeSalaryPayment, updateEmployeeSalaryPayment } from '../utils/employeePay';
import EmployeeSalaryFields, { emptySalaryForm, salaryTotal, SalaryForm } from './EmployeeSalaryFields';
import type { Employee, Transaction } from '../types';

interface Props {
  employees: Employee[];
  transactions: Transaction[];
  createdBy: string | null;
  onClose: () => void;
  onSaved: () => void;
  // When set, this reopens every non-void employee_salary payment dated
  // editDate as one editable batch (plus a blank row for anyone not paid
  // that day yet) instead of starting from 10 blank rows - so a bulk run
  // stays editable as the bulk run it was, not one payment at a time.
  editDate?: string;
}

// One row per active employee, all open at once, so a weekly pay run can be
// done in one sitting instead of opening "Pay Salary" once per person.
export default function BulkSalaryModal({ employees, transactions, createdBy, onClose, onSaved, editDate }: Props) {
  const [rows, setRows] = useState<SalaryForm[]>(() =>
    employees.map((emp) => {
      const existing = editDate
        ? transactions.find((t) => !t.is_void && t.type === 'employee_salary' && t.employee_id === emp.id && t.date === editDate)
        : undefined;
      if (existing) {
        const commission = existing.commission || 0;
        const loanDeduction = existing.employee_loan_deduction || 0;
        const advanceDeduction = existing.employee_advance_deduction || 0;
        const salaryAmount = (existing.amount || 0) - commission + loanDeduction + advanceDeduction;
        return {
          ...emptySalaryForm(existing.date),
          employeeId: emp.id,
          period: 'custom' as const,
          amount: String(salaryAmount),
          commission: commission ? String(commission) : '',
          loanDeduction: loanDeduction ? String(loanDeduction) : '',
          advanceDeduction: advanceDeduction ? String(advanceDeduction) : '',
          daysWorked: existing.days_worked ? String(existing.days_worked) : '',
          mode: existing.primary_mode || existing.commission_mode || 'cash',
          notes: existing.notes || '',
        };
      }
      return { ...emptySalaryForm(editDate || todayStr()), employeeId: emp.id, amount: !editDate && emp.weekly_salary ? String(emp.weekly_salary) : '' };
    })
  );
  const [rowTxnIds] = useState<(string | null)[]>(() =>
    employees.map((emp) => {
      if (!editDate) return null;
      const existing = transactions.find((t) => !t.is_void && t.type === 'employee_salary' && t.employee_id === emp.id && t.date === editDate);
      return existing?.id || null;
    })
  );
  const [saving, setSaving] = useState(false);

  function updateRow(idx: number, next: SalaryForm) {
    setRows((prev) => prev.map((r, i) => (i === idx ? next : r)));
  }

  async function handleSaveAll() {
    if (saving) return;
    setSaving(true);
    try {
      const failed: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const amount = parseFloat(row.amount || '0') || 0;
        const commission = parseFloat(row.commission || '0') || 0;
        const loanDeduction = parseFloat(row.loanDeduction || '0') || 0;
        const advanceDeduction = parseFloat(row.advanceDeduction || '0') || 0;
        const existingTxnId = rowTxnIds[i];
        // Skip rows nobody touched - a blank row shouldn't create a KES 0 payment.
        // A row that already had a payment and got cleared out is left alone here
        // too - void it from the ledger directly if it should be removed.
        if (amount === 0 && commission === 0 && loanDeduction === 0 && advanceDeduction === 0) continue;

        const emp = employees.find((e) => e.id === row.employeeId);
        if (!emp) continue;
        // Exclude this row's own existing payment before reading outstanding
        // loan/advance balances, or increasing its deduction would look like
        // it exceeds what's left when it doesn't.
        const ledgerTxns = existingTxnId ? transactions.filter((t) => t.id !== existingTxnId) : transactions;
        const activeLoan = calculateEmployeeLoans(ledgerTxns, emp.id).find((l) => l.remaining > 0);
        const activeAdvance = calculateEmployeeAdvances(ledgerTxns, emp.id).find((a) => a.remaining > 0);

        const input = {
          employeeId: emp.id,
          date: row.date,
          salaryAmount: amount,
          commission,
          loanDeduction,
          loanOutstanding: activeLoan?.remaining || 0,
          loanActiveRef: activeLoan?.transactionId || null,
          advanceDeduction,
          advanceOutstanding: activeAdvance?.remaining || 0,
          advanceActiveRef: activeAdvance?.transactionId || null,
          daysWorked: row.daysWorked ? parseInt(row.daysWorked, 10) : null,
          mode: row.mode,
          notes: row.notes || null,
          createdBy,
        };
        const result = existingTxnId
          ? await updateEmployeeSalaryPayment(existingTxnId, input)
          : await saveEmployeeSalaryPayment(input);
        if (!result.ok) failed.push(`${emp.name}: ${result.error}`);
      }

      if (failed.length > 0) {
        alert('Some payments failed to save:\n\n' + failed.join('\n'));
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-3xl max-h-[90vh] overflow-y-auto" data-form-nav>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800 text-sm">{editDate ? `Edit Salaries - ${editDate}` : 'Bulk Pay Salaries'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={14} /></button>
        </div>
        {employees.length === 0 ? (
          <p className="text-sm text-slate-400">No active employees.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row, idx) => {
              const emp = employees[idx];
              const total = salaryTotal(row);
              return (
                <div key={emp.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-slate-800">{emp.name}</h4>
                    <span className={`text-sm font-medium ${total < 0 ? 'text-red-600' : 'text-emerald-600'}`}>KES {formatKES(total)}</span>
                  </div>
                  <EmployeeSalaryFields employees={employees} transactions={transactions} form={row} onChange={(next) => updateRow(idx, next)} />
                </div>
              );
            })}
          </div>
        )}
        {employees.length > 0 && (
          <p className="text-sm font-medium text-slate-700 mt-3 pt-3 border-t border-slate-200">
            Total to pay (all employees): <span className="text-emerald-600">KES {formatKES(rows.reduce((sum, row) => sum + salaryTotal(row), 0))}</span>
          </p>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={handleSaveAll} disabled={saving || employees.length === 0} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-1.5 rounded text-sm font-medium">
            {saving ? 'Saving...' : 'Save All'}
          </button>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
