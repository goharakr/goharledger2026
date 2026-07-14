// Supabase caps a single request at 1000 rows by default, so a plain
// `.select('*')` on a table that grows past that silently drops rows
// instead of erroring - balances and totals would quietly go wrong with no
// sign anything's missing. This fetches every matching row in pages of
// 1000 instead, so a query keeps returning the full result no matter how
// large the table gets.
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const pageSize = 1000;
  let allRows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: allRows, error };
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { data: allRows, error: null };
}
