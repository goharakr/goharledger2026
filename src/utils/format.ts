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

export function generateTransactionId(type: string, date: string, seq: number): string {
  const prefix = type === 'sale' ? 'SAL' : type === 'expense' ? 'EXP' : 'TXN';
  const d = date.replace(/-/g, '');
  return `${prefix}-${d}-${String(seq).padStart(3, '0')}`;
}
