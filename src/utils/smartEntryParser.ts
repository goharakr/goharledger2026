// Parses a raw copy-paste from an external sales export (e.g. a POS system's
// sales table) into individual sale records. Built around the export format
// seen in practice: a "Sale Id / Date / Items / Sold By / Sold To / Subtotal /
// Total / Profit / Cost Of Goods Sold / Payment Type" row (tab-separated,
// often preceded by "+"/"Edit ####"/"Clone" action-button text from the
// source page), followed by a Comments line.

const DATE_RE = /(\d{2})-(\d{2})-(\d{4})-(\d{1,2}):(\d{2})\s*(am|pm)/i;

export interface ParsedSmartRow {
  posId: string | null;
  date: string; // ISO yyyy-mm-dd
  soldTo: string;
  total: number;
  costOfGoods: number;
  paymentTypeStr: string;
  comments: string;
}

export function parseKsh(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function isControlLine(line: string): boolean {
  const t = line.trim();
  if (t === '') return true;
  if (/^\+/.test(t)) return true;
  if (/^Edit\s+\d+$/i.test(t)) return true;
  if (/^Clone$/i.test(t)) return true;
  return false;
}

export function parseSmartEntryText(raw: string): ParsedSmartRow[] {
  const lines = raw.split('\n');
  const dataLineIdx: number[] = [];
  lines.forEach((l, idx) => { if (DATE_RE.test(l)) dataLineIdx.push(idx); });

  const rows: ParsedSmartRow[] = [];
  dataLineIdx.forEach((idx, k) => {
    const line = lines[idx];
    const cols = line.split('\t');
    const dateColIdx = cols.findIndex((c) => DATE_RE.test(c));
    const m = cols[dateColIdx].match(DATE_RE);
    if (!m) return;

    const soldTo = (cols[dateColIdx + 3] || '').trim();
    const total = parseKsh(cols[dateColIdx + 5]);
    const costOfGoods = parseKsh(cols[dateColIdx + 7]);
    const paymentTypeStr = (cols[dateColIdx + 8] || '').trim();

    // The source's own Sale ID sits in a preceding "Edit ####" line - carried
    // along purely so a re-paste of the same rows can be recognised and
    // skipped instead of silently creating a duplicate sale.
    let posId: string | null = null;
    for (let i = idx - 1; i >= 0 && i >= idx - 3; i--) {
      const em = lines[i].match(/Edit\s+(\d+)/i);
      if (em) { posId = em[1]; break; }
    }

    const nextIdx = dataLineIdx[k + 1] !== undefined ? dataLineIdx[k + 1] : lines.length;
    const commentLines: string[] = [];
    for (let i = idx + 1; i < nextIdx; i++) {
      if (!isControlLine(lines[i])) commentLines.push(lines[i].trim());
    }

    rows.push({
      posId,
      date: `${m[3]}-${m[2]}-${m[1]}`,
      soldTo,
      total,
      costOfGoods,
      paymentTypeStr,
      comments: commentLines.join(' ').trim(),
    });
  });
  return rows;
}

export type PaymentMode = 'cash' | 'mpesa' | 'paybill';

export interface PaymentPart {
  label: string;
  amount: number;
  mode: PaymentMode | null;
}

export function parsePayments(str: string): PaymentPart[] {
  if (!str) return [];
  const parts: PaymentPart[] = [];
  for (const part of str.split(',')) {
    const m = part.match(/([A-Za-z_ ]+):\s*Ksh?\s*([\d,]+\.?\d*)/i);
    if (!m) continue;
    const label = m[1].trim();
    const lower = label.toLowerCase();
    let mode: PaymentMode | null = null;
    if (lower.includes('mpesa')) mode = 'mpesa';
    else if (lower.includes('cash')) mode = 'cash';
    else if (lower.includes('im_bank') || lower.includes('bank') || lower.includes('paybill')) mode = 'paybill';
    parts.push({ label, amount: parseKsh(m[2]), mode });
  }
  return parts;
}

export interface CommissionDetection {
  amount: number;
  // true = comment explicitly says "LESS ### CMSN", safe to auto-apply.
  // false = comment says "LESS ###" without confirming it's commission -
  // flagged for a human to decide instead of guessing.
  confident: boolean;
}

export function detectCommission(comments: string): CommissionDetection | null {
  const strong = comments.match(/less\s+([\d,]+(?:\.\d+)?)\s*cmsn/i);
  if (strong) return { amount: parseKsh(strong[1]), confident: true };
  const weak = comments.match(/less\s+([\d,]+(?:\.\d+)?)/i);
  if (weak) return { amount: parseKsh(weak[1]), confident: false };
  return null;
}

// A second paste format seen in practice: a spreadsheet-style table with
// columns Date ("21/07 - Tue", no year) / ETR Check / Mode / Selling Price /
// Cost Price / Commission / Profit / KRA Profit / Comments (tab-separated).
// Distinct from the POS export above - both formats can appear in the same
// paste, and are parsed independently then merged by the caller.
const EXCEL_DATE_RE = /(\d{1,2})\/(\d{1,2})\s*-\s*[A-Za-z]{3}/;

export interface ParsedExcelRow {
  date: string; // ISO yyyy-mm-dd
  modeStr: string;
  sellingPrice: number;
  costPrice: number | null;
  commission: number;
  profit: number | null;
  comments: string;
}

function looksNumeric(s: string | undefined): boolean {
  return !!s && /^[\d,]+(\.\d+)?$/.test(s.trim());
}

// The day's header row repeats the same "DD/MM - Day" text in its own date
// column, so it matches EXCEL_DATE_RE too - it's told apart from a real data
// row by its Selling Price cell being the literal header text, not a number.
export function parseExcelSmartEntryText(raw: string, year: number): ParsedExcelRow[] {
  const rows: ParsedExcelRow[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(EXCEL_DATE_RE);
    if (!m) continue;
    const cols = line.split('\t');
    if (!looksNumeric(cols[3])) continue;

    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    rows.push({
      date: `${year}-${month}-${day}`,
      modeStr: (cols[2] || '').trim(),
      sellingPrice: parseKsh(cols[3]),
      costPrice: looksNumeric(cols[4]) ? parseKsh(cols[4]) : null,
      commission: looksNumeric(cols[5]) ? parseKsh(cols[5]) : 0,
      profit: looksNumeric(cols[6]) ? parseKsh(cols[6]) : null,
      comments: (cols[8] || '').trim(),
    });
  }
  return rows;
}

// A percentage deduction ("LESS 2%") isn't enough information to safely back
// out the real Commission/Selling Price on its own - this only flags the row
// for a human to check, it never drives an automatic adjustment.
export function detectPercentCommission(comments: string): number | null {
  const m = comments.match(/less\s+([\d.]+)\s*%/i);
  return m ? parseFloat(m[1]) : null;
}
