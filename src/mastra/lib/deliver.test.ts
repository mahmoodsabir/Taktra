import assert from 'node:assert/strict';
import test from 'node:test';

import { deliver, UndeliverableError, type DeliveryDeps } from './deliver.ts';

const deps = (
  target: { channel: 'telegram' | 'whatsapp' | 'push'; externalId: string } | null,
  configured: Array<'telegram' | 'whatsapp' | 'push'> = ['telegram'],
) => {
  const sent: Array<{ channel: string; to: string; body: string }> = [];
  const senders: DeliveryDeps['senders'] = {};
  for (const channel of configured) {
    senders[channel] = async (to, body) => {
      sent.push({ channel, to, body });
    };
  }
  return { sent, deps: { resolve: async () => target, senders } satisfies DeliveryDeps };
};

test('routes to whichever channel the user is reachable on', async () => {
  const tg = deps({ channel: 'telegram', externalId: '1650688352' });
  assert.deepEqual(await deliver('owner', 'hello', tg.deps), {
    channel: 'telegram',
    externalId: '1650688352',
  });
  assert.deepEqual(tg.sent, [{ channel: 'telegram', to: '1650688352', body: 'hello' }]);

  // The same call reaches a WhatsApp user with no change above this layer.
  const wa = deps({ channel: 'whatsapp', externalId: '+9647700000000' }, ['telegram', 'whatsapp']);
  const result = await deliver('someone', 'hello', wa.deps);
  assert.equal(result.channel, 'whatsapp');
  assert.equal(wa.sent[0].to, '+9647700000000');
});

test('a user with no linked channel fails loudly', async () => {
  // Silence here would mean a commitment marked as chased that nobody was ever told about.
  const none = deps(null);
  await assert.rejects(
    () => deliver('ghost', 'are you doing this?', none.deps),
    (error: UndeliverableError) => {
      assert.equal(error.reason, 'no-channel');
      return true;
    },
  );
  assert.deepEqual(none.sent, [], 'nothing was sent');
});

test('a channel this deployment cannot send on fails loudly too', async () => {
  // e.g. the user moved to WhatsApp but this instance has no WhatsApp credentials.
  const wa = deps({ channel: 'whatsapp', externalId: '+964770' }, ['telegram']);
  await assert.rejects(
    () => deliver('someone', 'hi', wa.deps),
    (error: UndeliverableError) => {
      assert.equal(error.reason, 'channel-unsupported');
      return true;
    },
  );
  assert.deepEqual(wa.sent, [], 'it must not quietly fall back to another channel');
});
