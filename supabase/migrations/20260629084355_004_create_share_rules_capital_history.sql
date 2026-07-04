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
