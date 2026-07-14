-- Full database schema for a brand-new Supabase project, combining every
-- migration under supabase/migrations/ in order. Paste this whole file into
-- your new project's SQL Editor (Supabase Dashboard > SQL Editor > New query)
-- and run it once. It creates every table this app needs, with no data in
-- them, ready for you to start entering your own.

-- ===== 20260629084326_001_create_users_and_business_profile.sql =====
/*
# Create users and business_profile tables

1. New Tables
- `users`: Stores app users (taher, abdulqadir, manager)
  - `id` (uuid, primary key)
  - `username` (text, unique, not null)
  - `password_hash` (text, not null) -- bcrypt hash
  - `role` (text, not null, default 'staff') -- admin, manager, staff
  - `full_name` (text)
  - `phone` (text)
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)

- `business_profile`: Single-row business info
  - `id` (uuid, primary key)
  - `business_name` (text)
  - `address` (text)
  - `phone` (text)
  - `email` (text)
  - `currency` (text, default 'KES')
  - `fiscal_year_start` (integer, default 1)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on both tables
- Allow anon + authenticated full access (single-tenant app)
*/

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  full_name text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text,
  address text,
  phone text,
  email text,
  currency text NOT NULL DEFAULT 'KES',
  fiscal_year_start integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_users" ON users;
CREATE POLICY "select_users" ON users FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_users" ON users;
CREATE POLICY "insert_users" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_users" ON users;
CREATE POLICY "update_users" ON users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_users" ON users;
CREATE POLICY "delete_users" ON users FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_business_profile" ON business_profile;
CREATE POLICY "select_business_profile" ON business_profile FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_business_profile" ON business_profile;
CREATE POLICY "insert_business_profile" ON business_profile FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_business_profile" ON business_profile;
CREATE POLICY "update_business_profile" ON business_profile FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_business_profile" ON business_profile;
CREATE POLICY "delete_business_profile" ON business_profile FOR DELETE TO anon, authenticated USING (true);


-- ===== 20260629084337_002_create_customers_suppliers_loans.sql =====
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


-- ===== 20260629084347_003_create_transactions_and_splits.sql =====
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


-- ===== 20260629084355_004_create_share_rules_capital_history.sql =====
/*
# Create share_rules, capital_entries, and historical_profit tables

1. New Tables
- `share_rules`: Profit share rules with history
  - `id` (uuid, primary key)
  - `partner_id` (text, not null) -- taher, abdulqadir
  - `rule_type` (text, not null) -- fixed, percentage
  - `value` (decimal(12,2), not null) -- amount in KES or percentage
  - `effective_from` (date, not null)
  - `effective_to` (date) -- null means still active
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)

- `capital_entries`: Opening capital and investment records
  - `id` (uuid, primary key)
  - `partner_id` (text, not null)
  - `entry_type` (text, not null) -- initial_capital, additional_investment, loan_repayment
  - `amount` (decimal(12,2), not null)
  - `date` (date, not null)
  - `description` (text)
  - `status` (text, default 'active')
  - `created_at` (timestamptz)

- `historical_profit`: Pre-system profit records for history
  - `id` (uuid, primary key)
  - `month` (text, not null) -- YYYY-MM format
  - `total_profit` (decimal(12,2), not null)
  - `taher_share` (decimal(12,2))
  - `abdulqadir_share` (decimal(12,2))
  - `taher_taken` (decimal(12,2), default 0)
  - `abdulqadir_taken` (decimal(12,2), default 0)
  - `retained` (decimal(12,2))
  - `notes` (text)
  - `created_at` (timestamptz)

2. Security
- Enable RLS, allow anon + authenticated full access
*/

CREATE TABLE IF NOT EXISTS share_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id text NOT NULL,
  rule_type text NOT NULL,
  value decimal(12,2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capital_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id text NOT NULL,
  entry_type text NOT NULL,
  amount decimal(12,2) NOT NULL,
  date date NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_profit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  total_profit decimal(12,2) NOT NULL,
  taher_share decimal(12,2),
  abdulqadir_share decimal(12,2),
  taher_taken decimal(12,2) DEFAULT 0,
  abdulqadir_taken decimal(12,2) DEFAULT 0,
  retained decimal(12,2),
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE share_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE historical_profit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_share_rules" ON share_rules;
CREATE POLICY "select_share_rules" ON share_rules FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_share_rules" ON share_rules;
CREATE POLICY "insert_share_rules" ON share_rules FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_share_rules" ON share_rules;
CREATE POLICY "update_share_rules" ON share_rules FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_share_rules" ON share_rules;
CREATE POLICY "delete_share_rules" ON share_rules FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_capital_entries" ON capital_entries;
CREATE POLICY "select_capital_entries" ON capital_entries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_capital_entries" ON capital_entries;
CREATE POLICY "insert_capital_entries" ON capital_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_capital_entries" ON capital_entries;
CREATE POLICY "update_capital_entries" ON capital_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_capital_entries" ON capital_entries;
CREATE POLICY "delete_capital_entries" ON capital_entries FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_historical_profit" ON historical_profit;
CREATE POLICY "select_historical_profit" ON historical_profit FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_historical_profit" ON historical_profit;
CREATE POLICY "insert_historical_profit" ON historical_profit FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_historical_profit" ON historical_profit;
CREATE POLICY "update_historical_profit" ON historical_profit FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_historical_profit" ON historical_profit;
CREATE POLICY "delete_historical_profit" ON historical_profit FOR DELETE TO anon, authenticated USING (true);


-- ===== 20260629093029_005_add_expense_categories_and_reminders.sql =====
/*
# Add expense_categories, loan_categories, and reminders tables

1. New Tables
- `expense_categories`: User-configurable expense categories
  - `id` (uuid, primary key)
  - `name` (text, not null, unique)
  - `description` (text)
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)

- `loan_categories`: User-configurable loan types
  - `id` (uuid, primary key)
  - `name` (text, not null, unique)
  - `description` (text)
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)

- `reminders`: Alerts for supplier/customer payments
  - `id` (uuid, primary key)
  - `reminder_type` (text, not null) -- supplier_payment, customer_collection
  - `entity_id` (uuid, not null) -- customer_id or supplier_id
  - `entity_type` (text, not null) -- customer, supplier
  - `amount` (decimal(12,2))
  - `due_date` (date, not null)
  - `reminder_date` (date, not null)
  - `status` (text, default 'pending') -- pending, completed, dismissed
  - `notes` (text)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on all tables
- Allow anon + authenticated full access
*/

CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  amount decimal(12,2),
  due_date date NOT NULL,
  reminder_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_expense_categories" ON expense_categories;
CREATE POLICY "select_expense_categories" ON expense_categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_expense_categories" ON expense_categories;
CREATE POLICY "insert_expense_categories" ON expense_categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_expense_categories" ON expense_categories;
CREATE POLICY "update_expense_categories" ON expense_categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_expense_categories" ON expense_categories;
CREATE POLICY "delete_expense_categories" ON expense_categories FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_loan_categories" ON loan_categories;
CREATE POLICY "select_loan_categories" ON loan_categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_loan_categories" ON loan_categories;
CREATE POLICY "insert_loan_categories" ON loan_categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_loan_categories" ON loan_categories;
CREATE POLICY "update_loan_categories" ON loan_categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_loan_categories" ON loan_categories;
CREATE POLICY "delete_loan_categories" ON loan_categories FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_reminders" ON reminders;
CREATE POLICY "select_reminders" ON reminders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_reminders" ON reminders;
CREATE POLICY "insert_reminders" ON reminders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_reminders" ON reminders;
CREATE POLICY "update_reminders" ON reminders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_reminders" ON reminders;
CREATE POLICY "delete_reminders" ON reminders FOR DELETE TO anon, authenticated USING (true);

-- Seed default expense categories
INSERT INTO expense_categories (name, description) VALUES
('rent', 'Shop rent'),
('utilities', 'Electricity, water, internet'),
('stock', 'Stock purchases'),
('salaries', 'Staff salaries'),
('transport', 'Transport costs'),
('maintenance', 'Shop maintenance'),
('idris_loan', 'Idris loan payments'),
('loan_repayment', 'Other loan repayments'),
('supplier_payment', 'Supplier payments'),
('misc', 'Miscellaneous expenses'),
('home_expense', 'Home/family expenses')
ON CONFLICT (name) DO NOTHING;


-- ===== 20260630120341_006_add_loan_payments_and_schema_updates.sql =====
/*
# Add loan_payments table and schema updates

1. New Tables
- `loan_payments`: Tracks individual payments against loans
  - `id` (uuid, primary key)
  - `loan_id` (uuid, references loan_trackers)
  - `date` (date, not null)
  - `amount` (decimal(12,2), not null)
  - `mode` (text) -- mpesa, cash, paybill
  - `notes` (text)
  - `created_at` (timestamptz)

2. Modified Tables
- `transactions`: Add `created_by` text column to track logged-in user
- `loan_trackers`: Add `amount_paid` column to track cumulative payments

3. Security
- Enable RLS on loan_payments
- Allow anon + authenticated full access
*/

CREATE TABLE IF NOT EXISTS loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loan_trackers(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount decimal(12,2) NOT NULL,
  mode text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Add amount_paid to loan_trackers if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loan_trackers' AND column_name = 'amount_paid') THEN
    ALTER TABLE loan_trackers ADD COLUMN amount_paid decimal(12,2) DEFAULT 0;
  END IF;
END $$;

-- Add created_by to transactions if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'created_by') THEN
    ALTER TABLE transactions ADD COLUMN created_by text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_date ON loan_payments(date);

ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_loan_payments" ON loan_payments;
CREATE POLICY "select_loan_payments" ON loan_payments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_loan_payments" ON loan_payments;
CREATE POLICY "insert_loan_payments" ON loan_payments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_loan_payments" ON loan_payments;
CREATE POLICY "update_loan_payments" ON loan_payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_loan_payments" ON loan_payments;
CREATE POLICY "delete_loan_payments" ON loan_payments FOR DELETE TO anon, authenticated USING (true);


-- ===== 20260704085849_add_reminder_time.sql =====
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS reminder_time TEXT DEFAULT '09:00';

-- ===== 20260704085851_add_due_date_to_transactions.sql =====
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS due_date DATE;

-- ===== 20260704150000_add_edited_at_to_transactions.sql =====
/*
  # Track when a transaction was edited

  Adds `edited_at`, set whenever a transaction is updated after its original
  creation (never set on insert). The app uses this to show a small
  "Edited" indicator wherever the transaction appears, so it's clear the
  original entry was changed later.
*/
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- ===== 20260706120000_add_settlement_mode_and_opening_balance_support.sql =====
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS settlement_mode text;

UPDATE transactions
SET settlement_mode = primary_mode,
    primary_mode = 'advance'
WHERE type = 'sale'
  AND primary_mode <> 'advance'
  AND notes LIKE 'Advance payment via%';

-- ===== 20260706120100_seed_users_table.sql =====
INSERT INTO users (username, password_hash, role, full_name, is_active)
VALUES
  ('taher', '9b7e94eed4b42296a9057e49f6bfa4eed80db9f70e4e438591ef6d1f1d4d30a9', 'admin', 'Taher', true),
  ('abdulqadir', '26f8c14ddb53966a2cf5759051fe5edb257610701ef647df083ba6321383d8b6', 'admin', 'Abdulqadir', true)
ON CONFLICT (username) DO NOTHING;

-- ===== 20260706120200_add_created_by_to_capital_and_historical.sql =====
ALTER TABLE capital_entries ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE historical_profit ADD COLUMN IF NOT EXISTS created_by text;


-- ===== 20260707100000_lock_rls_to_authenticated.sql =====
/*
# Require a real login for all database access

1. Background
- Every table's policies were `TO anon, authenticated USING (true)`, which
  means the public anon key alone (visible in the deployed JS bundle) granted
  full read/write/delete access to the entire database with no login at all.
- The app has moved from a forgeable localStorage session to real Supabase
  Auth (see AuthContext.tsx). This migration is the other half of that fix:
  it removes the `anon` grant everywhere so a request only succeeds once
  someone has actually signed in.

2. The one exception: `users` SELECT
- Logging in for the very first time under the new scheme still needs to read
  the `users` table (by username) as `anon`, before an Auth session exists,
  to check the old password hash and silently create the matching real Auth
  account. `select_users` is left open to `anon` for that bootstrap window.
- Once both partners have logged in at least once under the new system, a
  follow-up migration should drop the legacy fallback code and lock this
  last policy down to `authenticated` too.

3. Everything else
- INSERT/UPDATE/DELETE on `users`, and all four verbs on every other table,
  now require `authenticated`.
*/

-- users: keep SELECT open to anon (needed for the login bootstrap), lock the rest down
DROP POLICY IF EXISTS "insert_users" ON users;
CREATE POLICY "insert_users" ON users FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_users" ON users;
CREATE POLICY "update_users" ON users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_users" ON users;
CREATE POLICY "delete_users" ON users FOR DELETE TO authenticated USING (true);

-- business_profile
DROP POLICY IF EXISTS "select_business_profile" ON business_profile;
CREATE POLICY "select_business_profile" ON business_profile FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_business_profile" ON business_profile;
CREATE POLICY "insert_business_profile" ON business_profile FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_business_profile" ON business_profile;
CREATE POLICY "update_business_profile" ON business_profile FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_business_profile" ON business_profile;
CREATE POLICY "delete_business_profile" ON business_profile FOR DELETE TO authenticated USING (true);

-- customers
DROP POLICY IF EXISTS "select_customers" ON customers;
CREATE POLICY "select_customers" ON customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_customers" ON customers;
CREATE POLICY "insert_customers" ON customers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_customers" ON customers;
CREATE POLICY "update_customers" ON customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_customers" ON customers;
CREATE POLICY "delete_customers" ON customers FOR DELETE TO authenticated USING (true);

-- suppliers
DROP POLICY IF EXISTS "select_suppliers" ON suppliers;
CREATE POLICY "select_suppliers" ON suppliers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_suppliers" ON suppliers;
CREATE POLICY "insert_suppliers" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_suppliers" ON suppliers;
CREATE POLICY "update_suppliers" ON suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_suppliers" ON suppliers;
CREATE POLICY "delete_suppliers" ON suppliers FOR DELETE TO authenticated USING (true);

-- loan_trackers
DROP POLICY IF EXISTS "select_loan_trackers" ON loan_trackers;
CREATE POLICY "select_loan_trackers" ON loan_trackers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_loan_trackers" ON loan_trackers;
CREATE POLICY "insert_loan_trackers" ON loan_trackers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_loan_trackers" ON loan_trackers;
CREATE POLICY "update_loan_trackers" ON loan_trackers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_loan_trackers" ON loan_trackers;
CREATE POLICY "delete_loan_trackers" ON loan_trackers FOR DELETE TO authenticated USING (true);

-- transactions
DROP POLICY IF EXISTS "select_transactions" ON transactions;
CREATE POLICY "select_transactions" ON transactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_transactions" ON transactions;
CREATE POLICY "insert_transactions" ON transactions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_transactions" ON transactions;
CREATE POLICY "update_transactions" ON transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_transactions" ON transactions;
CREATE POLICY "delete_transactions" ON transactions FOR DELETE TO authenticated USING (true);

-- transaction_splits
DROP POLICY IF EXISTS "select_transaction_splits" ON transaction_splits;
CREATE POLICY "select_transaction_splits" ON transaction_splits FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_transaction_splits" ON transaction_splits;
CREATE POLICY "insert_transaction_splits" ON transaction_splits FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_transaction_splits" ON transaction_splits;
CREATE POLICY "update_transaction_splits" ON transaction_splits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_transaction_splits" ON transaction_splits;
CREATE POLICY "delete_transaction_splits" ON transaction_splits FOR DELETE TO authenticated USING (true);

-- share_rules
DROP POLICY IF EXISTS "select_share_rules" ON share_rules;
CREATE POLICY "select_share_rules" ON share_rules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_share_rules" ON share_rules;
CREATE POLICY "insert_share_rules" ON share_rules FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_share_rules" ON share_rules;
CREATE POLICY "update_share_rules" ON share_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_share_rules" ON share_rules;
CREATE POLICY "delete_share_rules" ON share_rules FOR DELETE TO authenticated USING (true);

-- capital_entries
DROP POLICY IF EXISTS "select_capital_entries" ON capital_entries;
CREATE POLICY "select_capital_entries" ON capital_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_capital_entries" ON capital_entries;
CREATE POLICY "insert_capital_entries" ON capital_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_capital_entries" ON capital_entries;
CREATE POLICY "update_capital_entries" ON capital_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_capital_entries" ON capital_entries;
CREATE POLICY "delete_capital_entries" ON capital_entries FOR DELETE TO authenticated USING (true);

-- historical_profit
DROP POLICY IF EXISTS "select_historical_profit" ON historical_profit;
CREATE POLICY "select_historical_profit" ON historical_profit FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_historical_profit" ON historical_profit;
CREATE POLICY "insert_historical_profit" ON historical_profit FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_historical_profit" ON historical_profit;
CREATE POLICY "update_historical_profit" ON historical_profit FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_historical_profit" ON historical_profit;
CREATE POLICY "delete_historical_profit" ON historical_profit FOR DELETE TO authenticated USING (true);

-- expense_categories
DROP POLICY IF EXISTS "select_expense_categories" ON expense_categories;
CREATE POLICY "select_expense_categories" ON expense_categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_expense_categories" ON expense_categories;
CREATE POLICY "insert_expense_categories" ON expense_categories FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_expense_categories" ON expense_categories;
CREATE POLICY "update_expense_categories" ON expense_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_expense_categories" ON expense_categories;
CREATE POLICY "delete_expense_categories" ON expense_categories FOR DELETE TO authenticated USING (true);

-- loan_categories
DROP POLICY IF EXISTS "select_loan_categories" ON loan_categories;
CREATE POLICY "select_loan_categories" ON loan_categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_loan_categories" ON loan_categories;
CREATE POLICY "insert_loan_categories" ON loan_categories FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_loan_categories" ON loan_categories;
CREATE POLICY "update_loan_categories" ON loan_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_loan_categories" ON loan_categories;
CREATE POLICY "delete_loan_categories" ON loan_categories FOR DELETE TO authenticated USING (true);

-- reminders
DROP POLICY IF EXISTS "select_reminders" ON reminders;
CREATE POLICY "select_reminders" ON reminders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_reminders" ON reminders;
CREATE POLICY "insert_reminders" ON reminders FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_reminders" ON reminders;
CREATE POLICY "update_reminders" ON reminders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_reminders" ON reminders;
CREATE POLICY "delete_reminders" ON reminders FOR DELETE TO authenticated USING (true);

-- loan_payments
DROP POLICY IF EXISTS "select_loan_payments" ON loan_payments;
CREATE POLICY "select_loan_payments" ON loan_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_loan_payments" ON loan_payments;
CREATE POLICY "insert_loan_payments" ON loan_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_loan_payments" ON loan_payments;
CREATE POLICY "update_loan_payments" ON loan_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_loan_payments" ON loan_payments;
CREATE POLICY "delete_loan_payments" ON loan_payments FOR DELETE TO authenticated USING (true);

-- ===== 20260713090000_create_monthly_balances_and_physical_cash_counts.sql =====
/*
# Create monthly_balances and physical_cash_counts

1. New Tables
- `monthly_balances`: manual override for a month's Forwarded Balance
  (Mpesa/Cash/Paybill carried into that month), used when the
  auto-calculated figure is wrong.
  - `id` (uuid, primary key)
  - `month` (text, unique, 'YYYY-MM')
  - `mpesa`, `cash`, `paybill` (numeric)
  - `created_at` (timestamptz)
- `physical_cash_counts`: a daily/monthly record of what was physically
  counted in Mpesa/Cash/Paybill vs what the system says it should be.
  - `id` (uuid, primary key)
  - `month` (text, unique, 'YYYY-MM')
  - `mpesa_actual`, `cash_actual`, `paybill_actual` (numeric)
  - `mpesa_system`, `cash_system`, `paybill_system` (numeric)
  - `counted_at` (timestamptz)

2. Security
- RLS enabled, locked to `authenticated` only (matching
  20260707100000_lock_rls_to_authenticated.sql for every other table).
*/

CREATE TABLE IF NOT EXISTS monthly_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text UNIQUE NOT NULL,
  mpesa numeric DEFAULT 0,
  cash numeric DEFAULT 0,
  paybill numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE monthly_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_monthly_balances" ON monthly_balances;
CREATE POLICY "select_monthly_balances" ON monthly_balances FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_monthly_balances" ON monthly_balances;
CREATE POLICY "insert_monthly_balances" ON monthly_balances FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_monthly_balances" ON monthly_balances;
CREATE POLICY "update_monthly_balances" ON monthly_balances FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_monthly_balances" ON monthly_balances;
CREATE POLICY "delete_monthly_balances" ON monthly_balances FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS physical_cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text UNIQUE NOT NULL,
  mpesa_actual numeric DEFAULT 0,
  cash_actual numeric DEFAULT 0,
  paybill_actual numeric DEFAULT 0,
  mpesa_system numeric DEFAULT 0,
  cash_system numeric DEFAULT 0,
  paybill_system numeric DEFAULT 0,
  counted_at timestamptz DEFAULT now()
);

ALTER TABLE physical_cash_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_physical_cash_counts" ON physical_cash_counts;
CREATE POLICY "select_physical_cash_counts" ON physical_cash_counts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_physical_cash_counts" ON physical_cash_counts;
CREATE POLICY "insert_physical_cash_counts" ON physical_cash_counts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_physical_cash_counts" ON physical_cash_counts;
CREATE POLICY "update_physical_cash_counts" ON physical_cash_counts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_physical_cash_counts" ON physical_cash_counts;
CREATE POLICY "delete_physical_cash_counts" ON physical_cash_counts FOR DELETE TO authenticated USING (true);
