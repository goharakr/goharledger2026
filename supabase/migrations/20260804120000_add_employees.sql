/*
# Employees: salaries, commission, loans, advances

1. New table: `employees`
- Master record for staff, mirroring the suppliers/customers pattern.
- `monthly_salary` / `weekly_salary` are both stored as reference figures -
  the Salary payment form auto-fills from whichever pay period is picked,
  but the actual amount paid is always typed/overwritable per payment.

2. New transaction types (added to `transactions`, no new tables for
   loans/advances - they're derived live from transactions, the same
   lesson this app already learned the hard way with stored balance
   columns silently drifting out of sync with the real ledger):
- `employee_salary` - one salary payment. `amount` is the NET cash paid
  out (after any loan/advance deduction) - the loan/advance deduction
  amounts are recorded in their own columns purely for the breakdown, they
  are not an additional cash movement.
- `employee_loan` - a loan given to an employee (real cash out).
- `employee_advance` - an advance given to an employee (real cash out).

3. New `transactions` columns
- `employee_id` - which employee this transaction belongs to.
- `employee_loan_ref` - on a salary payment that includes a loan
  deduction, the `transaction_id` of the `employee_loan` row it's paying
  down (self-referencing by transaction_id, same pattern as `refunded_of`).
- `employee_loan_deduction` - how much of this salary payment went to
  that loan.
- `employee_advance_ref` / `employee_advance_deduction` - same idea, for
  an advance instead of a loan.
- `days_worked` - optional attendance figure for a salary payment.
*/

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  monthly_salary decimal(12,2),
  weekly_salary decimal(12,2),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_employees" ON employees;
CREATE POLICY "select_employees" ON employees FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_employees" ON employees;
CREATE POLICY "insert_employees" ON employees FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_employees" ON employees;
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_employees" ON employees;
CREATE POLICY "delete_employees" ON employees FOR DELETE TO authenticated USING (true);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_loan_ref text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_loan_deduction decimal(12,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_advance_ref text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_advance_deduction decimal(12,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS days_worked integer;

CREATE INDEX IF NOT EXISTS idx_transactions_employee ON transactions(employee_id);
