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
