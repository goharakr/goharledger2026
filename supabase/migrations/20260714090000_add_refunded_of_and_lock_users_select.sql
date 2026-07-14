/*
# Track which sale a refund belongs to, and finish locking down `users`

1. `refunded_of`
- A refund is stored as a `sale`-type transaction with a negative amount.
  Until now it only linked back to the original sale through free text in
  `description` ("Refund - <transaction_id>"), which is fragile to match on
  and gave no way to reliably total up how much of a sale had already been
  refunded. `refunded_of` stores the original sale's `transaction_id`
  directly instead.

2. Finish the `users` SELECT lockdown
- 20260707100000_lock_rls_to_authenticated.sql deliberately left
  `select_users` open to `anon` for the login bootstrap window, with a note
  to lock it down once both partners had logged in under the new system.
  That's now done, so this closes the last open policy.
*/

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_of text;

DROP POLICY IF EXISTS "select_users" ON users;
CREATE POLICY "select_users" ON users FOR SELECT TO authenticated USING (true);
