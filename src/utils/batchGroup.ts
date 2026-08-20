import type { Transaction } from '../types';

// Groups transactions saved together in one Bulk Entry sitting: same type,
// non-void, and created within a couple of minutes of the row being edited.
// A bulk save's insert loop finishes in well under that window, while two
// separate entry sessions on the same day (even a single row each) are
// almost always further apart than that in real use - so this reliably
// tells "one bulk batch" apart from "just happens to share a date" without
// needing a stored batch ID.
export function findBulkBatch(transactions: Transaction[], target: Transaction, type: string, windowMs = 120000): Transaction[] {
  if (!target.created_at) return [target];
  const targetTime = new Date(target.created_at).getTime();
  return transactions.filter((t) =>
    !t.is_void && t.type === type && t.created_at &&
    Math.abs(new Date(t.created_at).getTime() - targetTime) <= windowMs
  );
}
