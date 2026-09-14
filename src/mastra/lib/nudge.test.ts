import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverNudge, type NudgeDeps } from './nudge.ts';

/** Records what was sent and marked, so ordering can be asserted. */
function spy(sendBehaviour: 'ok' | 'fail' = 'ok', failMarks: number[] = []) {
  const sent: string[] = [];
  const marked: number[] = [];
  const deps: NudgeDeps = {
    send: async (message) => {
      if (sendBehaviour === 'fail') throw new Error('Telegram unreachable');
      sent.push(message);
    },
    mark: async (id) => {
      if (failMarks.includes(id)) throw new Error(`cannot mark ${id}`);
      marked.push(id);
    },
  };
  return { sent, marked, deps };
}

test('a failed send marks nothing, so the next sweep retries', async () => {
  // The regression: a task must never be recorded as chased by a message that never
  // arrived. That silently spends its nudge budget and the commitment goes quiet.
  const { sent, marked, deps } = spy('fail');

  await assert.rejects(() => deliverNudge('are you doing this?', [1, 2, 3], deps), /unreachable/);

  assert.deepEqual(sent, [], 'nothing was delivered');
  assert.deepEqual(marked, [], 'so nothing may be marked nudged');
});

test('a delivered nudge marks exactly the tasks it mentioned', async () => {
  const { sent, marked, deps } = spy();

  const result = await deliverNudge('two things are overdue', [7, 9], deps);

  assert.deepEqual(sent, ['two things are overdue']);
  assert.deepEqual(marked, [7, 9]);
  assert.deepEqual(result.nudged, [7, 9]);
  assert.equal(result.delivered, true);
});

test('a task the agent did not mention is left alone', async () => {
  const { marked, deps } = spy();

  await deliverNudge('only about task 4', [4], deps);

  assert.deepEqual(marked, [4], 'unmentioned tasks keep their nudge budget');
});

test('a bookkeeping failure after delivery does not fail the nudge', async () => {
  // The message is already on the user's phone. Throwing here would make the agent
  // retry and send it twice; a duplicate later is the cheaper mistake.
  const { sent, marked, deps } = spy('ok', [2]);

  const result = await deliverNudge('three overdue', [1, 2, 3], deps);

  assert.deepEqual(sent.length, 1);
  assert.deepEqual(marked, [1, 3]);
  assert.deepEqual(result.nudged, [1, 3], 'reports only what was actually recorded');
});

test('a message with no tasks attached still sends', async () => {
  const { sent, marked, deps } = spy();

  const result = await deliverNudge('morning — your day is clear', [], deps);

  assert.deepEqual(sent.length, 1);
  assert.deepEqual(marked, []);
  assert.deepEqual(result.nudged, []);
});
