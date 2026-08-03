/*
# Link a Customer/Supplier record to a Partner

Some real-world parties (e.g. a partner's own separate shop) are both a
supplier and a customer to this shop, AND the same person is also a
partner here. `linked_partner_id` marks a suppliers/customers row as
"this belongs to partner X", so the app can offer settling that party's
balance against what the shop owes/has been paid by that partner
(Home Expenses Owed, Profit Share Not Taken), instead of only cash.

1. Changes
- `suppliers.linked_partner_id` (text, nullable)
- `customers.linked_partner_id` (text, nullable)
*/

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS linked_partner_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS linked_partner_id text;
