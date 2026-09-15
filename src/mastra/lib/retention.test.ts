import assert from 'node:assert/strict';
import test from 'node:test';

import { pruneTraces, type TraceStore } from './retention.ts';

/** A store holding traces keyed by start time, so the cutoff can be asserted. */
function fakeStore(traces: Array<{ traceId: string; startedAt: Date }>) {
  const calls: Array<{ cutoff?: Date; perPage?: number }> = [];
  const store: TraceStore = {
    async listTracesLight(args) {
      const cutoff = args.filters?.startedAt?.end;
      calls.push({ cutoff, perPage: args.pagination?.perPage });
      const matching = traces.filter((t) => !cutoff || t.startedAt < cutoff);
      return { spans: matching.slice(0, args.pagination?.perPage ?? 100) };
    },
    async batchDeleteTraces({ traceIds }) {
      for (const id of traceIds) {
        const i = traces.findIndex((t) => t.traceId === id);
        if (i >= 0) traces.splice(i, 1);
      }
    },
  };
  return { store, traces, calls };
}

const daysAgo = (n: number, from = new Date('2026-09-15T12:00:00Z')) =>
  new Date(from.getTime() - n * 86_400_000);

test('deletes only traces older than the cutoff', async () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const { store, traces } = fakeStore([
    { traceId: 'old-1', startedAt: daysAgo(30) },
    { traceId: 'old-2', startedAt: daysAgo(20) },
    { traceId: 'keep-1', startedAt: daysAgo(3) },
    { traceId: 'keep-2', startedAt: daysAgo(0) },
  ]);

  const result = await pruneTraces(store, { olderThanDays: 14, now });

  assert.equal(result.deleted, 2);
  assert.deepEqual(traces.map((t) => t.traceId).sort(), ['keep-1', 'keep-2']);
});

test('keeps everything when nothing is old enough', async () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const { store, traces } = fakeStore([{ traceId: 'recent', startedAt: daysAgo(1) }]);

  const result = await pruneTraces(store, { olderThanDays: 14, now });

  assert.equal(result.deleted, 0);
  assert.equal(traces.length, 1, 'recent traces are untouched');
});

test('is bounded, so a huge backlog does not stall the process', async () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const many = Array.from({ length: 5_000 }, (_, i) => ({
    traceId: `t-${i}`,
    startedAt: daysAgo(40),
  }));
  const { store, traces } = fakeStore(many);

  const result = await pruneTraces(store, { olderThanDays: 14, batchSize: 100, maxBatches: 3, now });

  assert.equal(result.batches, 3, 'stops at the batch ceiling');
  assert.equal(result.deleted, 300);
  assert.equal(traces.length, 4_700, 'the rest waits for the next run');
});

test('stops as soon as a page comes back empty', async () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const { store, calls } = fakeStore([{ traceId: 'old', startedAt: daysAgo(30) }]);

  await pruneTraces(store, { olderThanDays: 14, maxBatches: 20, now });

  // One page returning the trace, one confirming there is nothing left.
  assert.equal(calls.length, 2, 'does not keep querying an empty backlog');
});
