import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dbPath = './.tmp-life-manager-test.db';
for (const suffix of ['', '-shm', '-wal']) {
  if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = '';

const { addTodo, listTodos, updateTodo, computeEscalationLevel, todosDueForNudge } =
  await import('./todos.ts');

test('supports life-goal tracking and blocked follow-up states', async () => {
  const todo = await addTodo({
    title: 'Gym session',
    notes: 'Need to move after work.',
    area: 'health',
    priority: 'high',
    dueAt: '2099-01-01T18:00:00+00:00',
    minimumViableAction: '10-minute walk and mobility',
  });

  assert.equal(todo.area, 'health');
  assert.equal(todo.minimumViableAction, '10-minute walk and mobility');

  const updated = await updateTodo(todo.id, {
    status: 'blocked',
    statusReason: 'Waiting on the clinic to call back',
    escalationLevel: 1,
  });

  assert.equal(updated?.status, 'blocked');
  assert.equal(updated?.escalationLevel, 1);

  const blocked = await listTodos({ status: 'blocked', area: 'health' });
  assert.ok(blocked.some((item) => item.id === todo.id));
});

test('escalates what the owner can act on, and leaves blocked alone', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const base = {
    dueAt: null,
    area: 'work',
    priority: 'normal',
    lastNudgedAt: null,
    statusReason: null,
    minimumViableAction: null,
    escalationLevel: 0,
  } as const;

  // Stuck on the owner: chasing is the point.
  assert.equal(computeEscalationLevel({ ...base, status: 'stalled' } as never, now), 2);
  // Waiting on someone else: surfaced, never escalated.
  assert.equal(computeEscalationLevel({ ...base, status: 'blocked' } as never, now), 1);

  // Silence escalates a stalled task but must not escalate a blocked one, since the
  // owner going quiet says nothing about a third party.
  const silent = { ...base, lastNudgedAt: '2026-09-02T12:00:00Z' };
  assert.ok(computeEscalationLevel({ ...silent, status: 'stalled' } as never, now) >= 3);
  assert.equal(computeEscalationLevel({ ...silent, status: 'blocked' } as never, now), 1);

  const overdue = {
    ...base,
    status: 'open',
    dueAt: '2026-09-04T10:00:00Z',
    minimumViableAction: '10-minute walk',
  };
  assert.ok(computeEscalationLevel(overdue as never, now) >= 1);
});

test('the nudge sweep terminates for every undated status', async () => {
  // Regression: `blocked` with no due date used to re-select on every sweep forever,
  // because markNudged wrote `nudged_for_due_at = due_at` — NULL — leaving the
  // `nudged_for_due_at IS NULL` dedupe permanently true. One such task pinned the
  // */15 cron on and cost 96 full agent runs a day.
  const blocked = await addTodo({ title: 'chase-supplier', area: 'work' });
  await updateTodo(blocked.id, { status: 'blocked' });

  const stalled = await addTodo({ title: 'write-outline', area: 'work' });
  await updateTodo(stalled.id, { status: 'stalled' });

  const note = await addTodo({ title: 'gate-code-4821', area: 'personal' });
  await updateTodo(note.id, { status: 'note' });

  const mine = new Set([blocked.id, stalled.id, note.id]);
  const sweepMine = async () =>
    (await todosDueForNudge()).filter((t) => mine.has(t.id)).map((t) => t.title).sort();

  assert.deepEqual(await sweepMine(), ['chase-supplier', 'write-outline'], 'a note must never be nudged');

  for (const todo of await todosDueForNudge()) await updateTodo(todo.id, { markNudged: true });

  // Inside the cooldown, both go quiet — this is the loop the old query never exited.
  for (let sweep = 0; sweep < 3; sweep++) {
    assert.deepEqual(await sweepMine(), [], `sweep ${sweep + 2} should be silent`);
  }
});

test('a due task is nudged once per due time, and again when rescheduled', async () => {
  const todo = await addTodo({
    title: 'send-invoice',
    area: 'work',
    dueAt: new Date(Date.now() - 60_000).toISOString(),
  });

  assert.equal((await todosDueForNudge()).some((t) => t.id === todo.id), true);
  await updateTodo(todo.id, { markNudged: true });
  assert.equal((await todosDueForNudge()).some((t) => t.id === todo.id), false);

  // Rescheduling into the past earns a fresh nudge.
  await updateTodo(todo.id, { dueAt: new Date(Date.now() - 30_000).toISOString() });
  assert.equal((await todosDueForNudge()).some((t) => t.id === todo.id), true);
});

test('nextOccurrence advances from the due time, not from now', async () => {
  const { nextOccurrence } = await import('./todos.ts');
  const now = new Date('2026-09-20T12:00:00Z'); // a Sunday

  // A Friday task closed out on Sunday stays on Fridays.
  assert.equal(
    nextOccurrence('2026-09-18T07:00:00Z', 'weekly', now),
    '2026-09-25T07:00:00.000Z',
  );
  assert.equal(nextOccurrence('2026-09-20T06:00:00Z', 'daily', now), '2026-09-21T06:00:00.000Z');
  assert.equal(nextOccurrence('2026-09-15T09:00:00Z', 'monthly', now), '2026-10-15T09:00:00.000Z');
});

test('a long-neglected recurring task comes back once, not once per missed cycle', async () => {
  const { nextOccurrence } = await import('./todos.ts');
  const now = new Date('2026-09-20T12:00:00Z');

  // Six weeks untouched. It should land on the next future Friday, not replay the backlog.
  const next = nextOccurrence('2026-08-07T07:00:00Z', 'weekly', now);
  assert.ok(new Date(next) > now, 'must be in the future');
  assert.equal(next, '2026-09-25T07:00:00.000Z');
});

test('monthly recurrence never slides a late-month day into the next month', async () => {
  const { nextOccurrence } = await import('./todos.ts');
  // The 31st of January has no equivalent in February; it must clamp, not overflow to March.
  const next = nextOccurrence('2027-01-31T09:00:00Z', 'monthly', new Date('2027-01-31T10:00:00Z'));
  assert.equal(next, '2027-02-28T09:00:00.000Z');
});

test('completing a recurring commitment reopens it at the next due time', async () => {
  const todo = await addTodo({
    title: 'pay-the-rent',
    area: 'admin',
    recurrence: 'monthly',
    dueAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(todo.recurrence, 'monthly');

  const after = await updateTodo(todo.id, { status: 'done' });

  assert.equal(after?.status, 'open', 'a recurring commitment does not close');
  assert.ok(new Date(after!.dueAt!) > new Date(), 'it rolls to the next occurrence');
  assert.equal(after?.completedAt, null);

  // The new due time earns a fresh nudge rather than inheriting the old one.
  assert.equal((await todosDueForNudge()).some((t) => t.id === todo.id), false);
});

test('dropping a recurring commitment actually ends it', async () => {
  const todo = await addTodo({
    title: 'stop-this-one',
    area: 'personal',
    recurrence: 'weekly',
    dueAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const after = await updateTodo(todo.id, { status: 'dropped' });
  assert.equal(after?.status, 'dropped', 'dropped is how a recurrence is ended');
});

test('a non-recurring task still closes normally', async () => {
  const todo = await addTodo({ title: 'one-off', area: 'work' });
  const after = await updateTodo(todo.id, { status: 'done' });
  assert.equal(after?.status, 'done');
  assert.ok(after?.completedAt);
});

test('one account never sees another account\'s commitments', async () => {
  // The whole point of user_id: without scoping, a second user's tasks land in the
  // first user's list, and the nudge sweep reads them out to the wrong person.
  const mine = await addTodo({ userId: 'user-a', title: 'a-private-task', area: 'work' });
  await addTodo({ userId: 'user-b', title: 'b-private-task', area: 'work' });

  const aList = await listTodos({ userId: 'user-a' });
  assert.deepEqual(aList.map((t) => t.title), ['a-private-task']);

  const bList = await listTodos({ userId: 'user-b' });
  assert.deepEqual(bList.map((t) => t.title), ['b-private-task']);

  assert.equal(mine.userId, 'user-a', 'a commitment records who it belongs to');
});

test('the nudge sweep only ever gathers one account at a time', async () => {
  const overdue = () => new Date(Date.now() - 60_000).toISOString();
  await addTodo({ userId: 'sweep-a', title: 'a-overdue', area: 'work', dueAt: overdue() });
  await addTodo({ userId: 'sweep-b', title: 'b-overdue', area: 'work', dueAt: overdue() });

  const forA = await todosDueForNudge(15, 'sweep-a');
  assert.deepEqual(forA.map((t) => t.title), ['a-overdue'], "b's commitments must not appear");

  const forB = await todosDueForNudge(15, 'sweep-b');
  assert.deepEqual(forB.map((t) => t.title), ['b-overdue']);
});

test('the struggle is recorded, not just the outcome', async () => {
  // This is the whole point: "done" tells you nothing about habits. The path does.
  const { todoHistory } = await import('./todos.ts');

  const t = await addTodo({
    userId: 'hist',
    title: 'write-the-proposal',
    area: 'work',
    dueAt: '2026-10-01T09:00:00Z',
  });
  await updateTodo(t.id, { status: 'stalled', statusReason: 'avoiding it' });
  await updateTodo(t.id, { dueAt: '2026-10-08T09:00:00Z' });
  await updateTodo(t.id, { markNudged: true });
  await updateTodo(t.id, { status: 'done' });

  const kinds = (await todoHistory(t.id)).map((e) => e.kind);
  assert.deepEqual(kinds, ['created', 'status_changed', 'rescheduled', 'nudged', 'status_changed']);

  const statusChanges = (await todoHistory(t.id)).filter((e) => e.kind === 'status_changed');
  assert.deepEqual(
    statusChanges.map((e) => [e.fromValue, e.toValue]),
    [['open', 'stalled'], ['stalled', 'done']],
    'each transition keeps where it came from',
  );
});

test('history is append-only — later changes never rewrite earlier facts', async () => {
  const { todoHistory } = await import('./todos.ts');

  const t = await addTodo({ userId: 'append', title: 'immutable', area: 'work' });
  await updateTodo(t.id, { status: 'stalled' });
  const afterTwo = await todoHistory(t.id);

  await updateTodo(t.id, { status: 'done' });
  const afterThree = await todoHistory(t.id);

  assert.equal(afterThree.length, afterTwo.length + 1, 'only grows');
  assert.deepEqual(
    afterThree.slice(0, afterTwo.length).map((e) => [e.id, e.kind, e.fromValue, e.toValue]),
    afterTwo.map((e) => [e.id, e.kind, e.fromValue, e.toValue]),
    'earlier rows are untouched',
  );
});

test('a recurring commitment leaves a trace each time it comes round', async () => {
  // It reopens rather than closing, so without an explicit event a completed occurrence
  // would look like nothing happened at all.
  const { todoHistory } = await import('./todos.ts');

  const t = await addTodo({
    userId: 'recur',
    title: 'weekly-review',
    area: 'work',
    recurrence: 'weekly',
    dueAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await updateTodo(t.id, { status: 'done' });

  const kinds = (await todoHistory(t.id)).map((e) => e.kind);
  assert.ok(kinds.includes('recurrence_rolled'), `expected a roll event, got ${kinds.join(', ')}`);
});

test('events are scoped per account and queryable by window', async () => {
  const { listEvents } = await import('./todos.ts');

  await addTodo({ userId: 'ev-a', title: 'a-task', area: 'work' });
  await addTodo({ userId: 'ev-b', title: 'b-task', area: 'work' });

  const forA = await listEvents({ userId: 'ev-a' });
  assert.ok(forA.length >= 1);
  assert.ok(forA.every((e) => e.userId === 'ev-a'), 'no cross-account leakage into analytics');

  const future = await listEvents({ userId: 'ev-a', since: '2099-01-01T00:00:00Z' });
  assert.deepEqual(future, [], 'the window is honoured');
});
