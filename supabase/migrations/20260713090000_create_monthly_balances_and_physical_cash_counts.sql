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
