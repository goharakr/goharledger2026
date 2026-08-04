import { useState } from 'react';
import { X } from 'lucide-react';
import { formatKES, todayStr } from '../utils/format';
import { calculateEmployeeLoans, calculateEmployeeAdvances, saveEmployeeSalaryPayment } from '../utils/employeePay';
import EmployeeSalaryFields, { emptySalaryForm, salaryTotal, SalaryForm } from './EmployeeSalaryFields';
import type { Employee, Transaction } from '../types';

interface Props {
  employees: Employee[];
  transactions: Transaction[];
  createdBy: string | null;
  onClose: () => void;
  onSaved: () => void;
}

// One row per active employee, all open at once, so a weekly pay run can be
// done in one sitting instead of opening "Pay Salary" once per person.
export default function BulkSalaryModal({ employees, transactions, createdBy, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<SalaryForm[]>(() =>
    employees.map((emp) => ({ ...emptySalaryForm(todayStr()), employeeId: emp.id, amount: emp.weekly_salary ? String(emp.weekly_salary) : '' }))
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
      for (const row of rows) {
        const amount = parseFloat(row.amount || '0') || 0;
        const commission = parseFloat(row.commission || '0') || 0;
        const loanDeduction = parseFloat(row.loanDeduction || '0') || 0;
        const advanceDeduction = parseFloat(row.advanceDeduction || '0') || 0;
        // Skip rows nobody touched - a blank row shouldn't create a KES 0 payment.
        if (amount === 0 && commission === 0 && loanDeduction === 0 && advanceDeduction === 0) continue;

        const emp = employees.find((e) => e.id === row.employeeId);
        if (!emp) continue;
        const activeLoan = calculateEmployeeLoans(transactions, emp.id).find((l) => l.remaining > 0);
        const activeAdvance = calculateEmployeeAdvances(transactions, emp.id).find((a) => a.remaining > 0);

        const result = await saveEmployeeSalaryPayment({
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
        });
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
          <h3 className="font-semibold text-slate-800 text-sm">Bulk Pay Salaries</h3>
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
