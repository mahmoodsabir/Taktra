import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dbPath = './.tmp-users-test.db';
for (const suffix of ['', '-shm', '-wal']) {
  if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = '';
process.env.TELEGRAM_OWNER_CHAT_ID = '1650688352';
process.env.TIMEZONE = 'Asia/Baghdad';

const { OWNER_USER_ID, createUser, findUserByChannel, getUser, linkChannel, listChannels, primaryChannel } =
  await import('./users.ts');

test('the existing single-user installation is seeded as an account', async () => {
  // Without this, turning on multi-user scoping would strand the owner's own history.
  const owner = await getUser(OWNER_USER_ID);
  assert.equal(owner?.status, 'active');
  assert.equal(owner?.timezone, 'Asia/Baghdad', 'timezone moves onto the user, off the env');

  const viaTelegram = await findUserByChannel('telegram', '1650688352');
  assert.equal(viaTelegram?.id, OWNER_USER_ID, 'their configured chat becomes a channel');
});

test('an inbound address resolves to its account, and an unknown one to nobody', async () => {
  assert.equal((await findUserByChannel('telegram', '1650688352'))?.id, OWNER_USER_ID);
  assert.equal(await findUserByChannel('telegram', '999999'), null);
  assert.equal(await findUserByChannel('whatsapp', '1650688352'), null, 'channels are separate namespaces');
});

test('one account can be reached on several channels', async () => {
  await linkChannel({
    userId: OWNER_USER_ID,
    channel: 'whatsapp',
    externalId: '+9647700000000',
    isPrimary: true,
    verified: true,
  });

  const channels = await listChannels(OWNER_USER_ID);
  assert.deepEqual(channels.map((c) => c.channel).sort(), ['telegram', 'whatsapp']);

  const primary = await primaryChannel(OWNER_USER_ID);
  assert.equal(primary?.channel, 'whatsapp', 'the newest primary wins');
  assert.equal(
    channels.filter((c) => c.isPrimary).length,
    1,
    'exactly one channel is primary, or nudges would go twice',
  );

  // Switching back must not duplicate the row or leave two primaries.
  await linkChannel({ userId: OWNER_USER_ID, channel: 'telegram', externalId: '1650688352', isPrimary: true });
  const after = await listChannels(OWNER_USER_ID);
  assert.equal(after.length, 2, 'relinking updates rather than inserts');
  assert.equal((await primaryChannel(OWNER_USER_ID))?.channel, 'telegram');
});

test('a reused phone number moves to its new owner rather than leaking history', async () => {
  // Numbers get recycled. The previous holder's commitments must not follow them.
  await createUser({ id: 'someone-else', timezone: 'Europe/London' });
  await linkChannel({ userId: 'someone-else', channel: 'whatsapp', externalId: '+9647700000000' });

  const resolved = await findUserByChannel('whatsapp', '+9647700000000');
  assert.equal(resolved?.id, 'someone-else');
  assert.ok(
    !(await listChannels(OWNER_USER_ID)).some((c) => c.externalId === '+9647700000000'),
    'the address no longer belongs to the previous account',
  );
});
