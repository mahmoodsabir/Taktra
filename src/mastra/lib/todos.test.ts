import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dbPath = './.tmp-life-manager-test.db';
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = '';

const { addTodo, listTodos, updateTodo, computeEscalationLevel } = await import('./todos.ts');

test('supports life-goal tracking and blocked follow-up states', async () => {
  const todo = await addTodo({
    title: 'Gym session',
    notes: 'Need to move after work.',
    context: 'health',
    priority: 'high',
    dueAt: '2099-01-01T18:00:00+00:00',
    minimumViableAction: '10-minute walk and mobility',
  });

  assert.equal(todo.context, 'health');
  assert.equal(todo.minimumViableAction, '10-minute walk and mobility');

  const updated = await updateTodo(todo.id, {
    status: 'blocked',
    statusReason: 'Busy with family logistics and low energy',
    escalationLevel: 1,
  });

  assert.equal(updated?.status, 'blocked');
  assert.equal(updated?.statusReason, 'Busy with family logistics and low energy');
  assert.equal(updated?.escalationLevel, 1);

  const blocked = await listTodos({ status: 'blocked', context: 'health' });
  assert.ok(blocked.some((item) => item.id === todo.id));
});

test('escalates blocked or overdue life tasks toward a practical next step', () => {
  const now = new Date('2026-09-04T12:00:00Z');

  const overdue = {
    status: 'open',
    dueAt: '2026-09-04T10:00:00Z',
    context: 'health',
    priority: 'high',
    lastNudgedAt: '2026-09-04T08:00:00Z',
    statusReason: null,
    minimumViableAction: '10-minute walk + mobility',
    escalationLevel: 0,
  } as const;

  const blocked = {
    status: 'blocked',
    dueAt: '2026-09-05T18:00:00Z',
    context: 'family',
    priority: 'normal',
    lastNudgedAt: '2026-09-04T11:00:00Z',
    statusReason: 'Busy with family logistics and low energy',
    minimumViableAction: 'Message the clinic and book the first available slot',
    escalationLevel: 1,
  } as const;

  assert.ok(computeEscalationLevel(overdue as any, now) >= 1);
  assert.ok(computeEscalationLevel(blocked as any, now) >= 1);
});
