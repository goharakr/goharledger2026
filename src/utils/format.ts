// Formats a Date using its LOCAL calendar date, not toISOString() (which
// converts to UTC and lands on the wrong day for part of the day in Kenya,
// UTC+3 - e.g. local 00:00-02:59 is still "yesterday" in UTC).
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return localDateStr(new Date());
}

export function thisMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatKES(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '0';
  return amount.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-KE', {
    month: 'short',
    day: 'numeric',
  });
}

export function getMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + '-01');
  return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'long' });
}

// A sale whose cost price hasn't been entered yet (cost not yet billed by a
// supplier, or genuinely unknown) has an unknown profit - not a profit equal
// to the full selling price. Until the real cost is filled in (via Edit),
// this sale contributes 0 to every profit total, matching how it's tracked
// on paper: profit deferred, not assumed to be 100%.
//
// Commission is NOT subtracted here - it's recorded as its own Expense
// (category "commission") instead, so it reduces overall profit at the
// expense stage rather than inside the sale itself.
export function saleProfit(t: { selling_price?: number | null; cost_price?: number | null }): number {
  if (t.cost_price === null || t.cost_price === undefined) return 0;
  return (t.selling_price || 0) - t.cost_price;
}

// Flags a sale row that's missing its payment mode, cost price, or selling
// price - used to highlight rows in a ledger/list that still need something
// filled in, rather than letting them blend in silently.
export function isSaleIncomplete(t: { type?: string; primary_mode?: string | null; cost_price?: number | null; selling_price?: number | null }): boolean {
  if (t.type !== 'sale') return false;
  return !t.primary_mode || t.cost_price === null || t.cost_price === undefined || t.selling_price === null || t.selling_price === undefined;
}

