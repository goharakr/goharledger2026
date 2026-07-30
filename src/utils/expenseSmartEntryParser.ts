// Parses a raw copy-paste of a monthly expenses sheet: Date (a bare day
// ordinal like "1ST"/"2ND", no month/year) / Mode / Type / Amount / Comment,
// tab-separated. The sheet's date column has no month or year in it - the
// caller supplies which month/year to assume (normally the current one).

export interface ParsedExpenseRow {
  day: number;
  mode: string;
  type: string;
  amount: number;
  comment: string;
}

const DAY_RE = /^(\d{1,2})(?:ST|ND|RD|TH)?$/i;

function parseAmount(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function parseExpenseSheetText(raw: string): ParsedExpenseRow[] {
  const rows: ParsedExpenseRow[] = [];
  for (const line of raw.split('\n')) {
    const cols = line.split('\t');
    const dayMatch = (cols[0] || '').trim().match(DAY_RE);
    if (!dayMatch) continue;
    const amount = parseAmount(cols[3]);
    if (!amount) continue;
    rows.push({
      day: parseInt(dayMatch[1], 10),
      mode: (cols[1] || '').trim(),
      type: (cols[2] || '').trim().toUpperCase(),
      amount,
      comment: (cols[4] || '').trim(),
    });
  }
  return rows;
}
