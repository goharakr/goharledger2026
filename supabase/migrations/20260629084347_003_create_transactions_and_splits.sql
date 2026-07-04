/*
# Create transactions and transaction_splits tables

1. New Tables
- `transactions`: Universal ledger - every financial event is one row
  - `id` (uuid, primary key)
  - `transaction_id` (text, unique) -- formatted: SAL-YYYYMMDD-001, EXP-YYYYMMDD-001
  - `date` (date, not null)
  - `type` (text, not null) -- sale, expense, fund_transfer, partner_draw, partner_loan, customer_payment, supplier_payment, capital_entry, loan_payment
  - `primary_mode` (text) -- mpesa, cash, paybill, credit, advance, supplier, split
  - `amount` (decimal(12,2), not null)
  - `description` (text)
  - `notes` (text)
  - `partner_id` (text) -- taher, abdulqadir, or null
  - `customer_id` (uuid, references customers)
  - `supplier_id` (uuid, references suppliers)
  - `loan_id` (uuid, references loan_trackers)
  - `category` (text) -- rent, utilities, stock, salaries, transport, maintenance, idris_loan, loan_repayment, supplier_payment, misc, home_expense
  - `selling_price` (decimal(12,2))
  - `cost_price` (decimal(12,2))
  - `commission` (decimal(12,2))
  - `commission_mode` (text)
  - `is_void` (boolean, default false)
  - `void_reason` (text)
  - `is_unclassified` (boolean, default false)
  - `created_by` (text)
  - `created_at` (timestamptz)

- `transaction_splits`: Child table for split payments
  - `id` (uuid, primary key)
  - `transaction_id` (text, references transactions.transaction_id)
  - `mode` (text, not null) -- mpesa, cash, paybill
  - `amount` (decimal(12,2), not null)
  - `created_at` (timestamptz)

2. Indexes
- transactions.date, transactions.type, transactions.partner_id, transactions.customer_id, transactions.supplier_id

3. Security
- Enable RLS, allow anon + authenticated full access
*/

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text UNIQUE NOT NULL,
  date date NOT NULL,
  type text NOT NULL,
  primary_mode text,
  amount decimal(12,2) NOT NULL,
  description text,
  notes text,
  partner_id text,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  loan_id uuid REFERENCES loan_trackers(id) ON DELETE SET NULL,
  category text,
  selling_price decimal(12,2),
  cost_price decimal(12,2),
  commission decimal(12,2),
  commission_mode text,
  is_void boolean NOT NULL DEFAULT false,
  void_reason text,
  is_unclassified boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  mode text NOT NULL,
  amount decimal(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_partner ON transactions(partner_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_supplier ON transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_transactions_loan ON transactions(loan_id);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_txn ON transaction_splits(transaction_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_transactions" ON transactions;
CREATE POLICY "select_transactions" ON transactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_transactions" ON transactions;
CREATE POLICY "insert_transactions" ON transactions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_transactions" ON transactions;
CREATE POLICY "update_transactions" ON transactions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_transactions" ON transactions;
CREATE POLICY "delete_transactions" ON transactions FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_transaction_splits" ON transaction_splits;
CREATE POLICY "select_transaction_splits" ON transaction_splits FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_transaction_splits" ON transaction_splits;
CREATE POLICY "insert_transaction_splits" ON transaction_splits FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_transaction_splits" ON transaction_splits;
CREATE POLICY "update_transaction_splits" ON transaction_splits FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_transaction_splits" ON transaction_splits;
CREATE POLICY "delete_transaction_splits" ON transaction_splits FOR DELETE TO anon, authenticated USING (true);
