/**
 * Pruning observability traces.
 *
 * Traces are exhaust, not data: one user generated roughly 290 MB in a couple of weeks,
 * about a hundred times the size of everything the product actually knows. Nothing deletes
 * them, so the fastest-growing thing on the disk is the least valuable, and it fills a
 * small host long before the real database becomes a problem.
 *
 * Written against a minimal slice of the store rather than the concrete DuckDB type so it
 * can be exercised without a database.
 */

export interface TraceStore {
  listTracesLight(args: {
    filters?: { startedAt?: { end?: Date; endExclusive?: boolean } };
    pagination?: { page: number; perPage: number };
  }): Promise<{ spans?: Array<{ traceId?: string | null }> }>;
  batchDeleteTraces(args: { traceIds: string[] }): Promise<void>;
}

export interface PruneResult {
  deleted: number;
  batches: number;
}

/**
 * Delete traces that started before the cutoff.
 *
 * Deliberately bounded: it deletes at most `maxBatches` pages per run rather than looping
 * until the backlog is gone. A first run against months of accumulated traces would
 * otherwise hold the store busy for a long time at boot, and the next run picks up where
 * this one stopped.
 */
export async function pruneTraces(
  store: TraceStore,
  {
    olderThanDays = 14,
    batchSize = 500,
    maxBatches = 20,
    now = new Date(),
  }: { olderThanDays?: number; batchSize?: number; maxBatches?: number; now?: Date } = {},
): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
  let deleted = 0;
  let batches = 0;

  for (; batches < maxBatches; batches++) {
    const page = await store.listTracesLight({
      filters: { startedAt: { end: cutoff, endExclusive: true } },
      // Always page 0: the previous batch has been deleted, so the next oldest traces
      // take its place. Paging forward would skip over them.
      pagination: { page: 0, perPage: batchSize },
    });

    const traceIds = [...new Set((page.spans ?? []).map((s) => s.traceId).filter(Boolean))] as string[];
    if (traceIds.length === 0) break;

    await store.batchDeleteTraces({ traceIds });
    deleted += traceIds.length;
  }

  return { deleted, batches };
}
