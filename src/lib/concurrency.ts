/**
 * Bounded-concurrency map. Replaces ThreadPoolExecutor(max_workers=8) from the
 * Python jobs.
 *
 * Never rejects: a failing item resolves to `{ ok: false, error }` so callers can
 * count failures into the phase's coverage stats rather than losing the whole
 * batch to one inaccessible report.
 */
export type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function mapLimit<In, Out>(
  items: readonly In[],
  limit: number,
  fn: (item: In, index: number) => Promise<Out>,
): Promise<Settled<Out>[]> {
  const results = new Array<Settled<Out>>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/** Split into fixed-size chunks — used for COUNT batches and MCD Id batches. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
