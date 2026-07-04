/*
# Create customers, suppliers, and loan_trackers tables

1. New Tables
- `customers`: Customer records for credit/advance tracking
  - `id` (uuid, primary key)
  - `name` (text, not null)
  - `phone` (text)
  - `credit_limit` (decimal, default 0)
  - `credit_balance` (decimal, default 0)
  - `advance_balance` (decimal, default 0)
  - `notes` (text)
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)

- `suppliers`: Supplier records for purchase tracking
  - `id` (uuid, primary key)
  - `name` (text, not null)
  - `phone` (text)
  - `balance` (decimal, default 0) -- what shop owes supplier
  - `notes` (text)
  - `is_dual_party` (boolean, default false) -- also a customer
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)

- `loan_trackers`: All shop loans (Idris, bank, etc.)
  - `id` (uuid, primary key)
  - `loan_name` (text, not null)
  - `loan_type` (text, not null) -- shop_loan
  - `total_amount` (decimal, not null)
  - `remaining_balance` (decimal, not null)
  - `monthly_installment` (decimal)
  - `start_date` (date)
  - `status` (text, default 'active') -- active, settled
  - `notes` (text)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on all tables
- Allow anon + authenticated full access
*/

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  credit_limit decimal(12,2) DEFAULT 0,
  credit_balance decimal(12,2) DEFAULT 0,
  advance_balance decimal(12,2) DEFAULT 0,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  balance decimal(12,2) DEFAULT 0,
  notes text,
  is_dual_party boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_trackers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_name text NOT NULL,
  loan_type text NOT NULL DEFAULT 'shop_loan',
  total_amount decimal(12,2) NOT NULL,
  remaining_balance decimal(12,2) NOT NULL,
  monthly_installment decimal(12,2),
  start_date date,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_trackers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_customers" ON customers;
CREATE POLICY "select_customers" ON customers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_customers" ON customers;
CREATE POLICY "insert_customers" ON customers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_customers" ON customers;
CREATE POLICY "update_customers" ON customers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_customers" ON customers;
CREATE POLICY "delete_customers" ON customers FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_suppliers" ON suppliers;
CREATE POLICY "select_suppliers" ON suppliers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_suppliers" ON suppliers;
CREATE POLICY "insert_suppliers" ON suppliers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_suppliers" ON suppliers;
CREATE POLICY "update_suppliers" ON suppliers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_suppliers" ON suppliers;
CREATE POLICY "delete_suppliers" ON suppliers FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_loan_trackers" ON loan_trackers;
CREATE POLICY "select_loan_trackers" ON loan_trackers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_loan_trackers" ON loan_trackers;
CREATE POLICY "insert_loan_trackers" ON loan_trackers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_loan_trackers" ON loan_trackers;
CREATE POLICY "update_loan_trackers" ON loan_trackers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_loan_trackers" ON loan_trackers;
CREATE POLICY "delete_loan_trackers" ON loan_trackers FOR DELETE TO anon, authenticated USING (true);
