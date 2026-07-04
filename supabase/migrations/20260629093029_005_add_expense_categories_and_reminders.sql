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
