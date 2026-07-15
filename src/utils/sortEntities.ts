import type { Customer, Supplier } from '../types';

// Puts every customer/supplier with a nonzero balance first (so the one
// you're about to look for in a dropdown - the one who owes money or is
// owed money - isn't buried under everyone with nothing outstanding),
// alphabetical within each group.
function sortByBalance<T>(items: T[], hasBalance: (item: T) => boolean, name: (item: T) => string): T[] {
  const withBalance = items.filter(hasBalance).sort((a, b) => name(a).localeCompare(name(b)));
  const withoutBalance = items.filter((i) => !hasBalance(i)).sort((a, b) => name(a).localeCompare(name(b)));
  return [...withBalance, ...withoutBalance];
}

export function sortCustomersByBalance(customers: Customer[]): Customer[] {
  return sortByBalance(customers, (c) => !!(c.credit_balance || c.advance_balance), (c) => c.name);
}

export function sortSuppliersByBalance(suppliers: Supplier[]): Supplier[] {
  return sortByBalance(suppliers, (s) => !!s.balance, (s) => s.name);
}
