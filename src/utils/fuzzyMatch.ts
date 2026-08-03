// Small local name-similarity helper - no fuzzy-match library dependency needed
// for matching a pasted "Sold To" name against existing customers/suppliers.

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// 1 = identical, 0 = nothing in common. Substring matches score high (0.9)
// since "HATIM" vs "HATIM GLASS WORLD" should be treated as a strong match.
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

export function findBestMatch<T>(
  name: string,
  items: T[],
  getName: (item: T) => string,
  threshold = 0.5
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = similarity(name, getName(item));
    if (score >= threshold && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best;
}
