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
