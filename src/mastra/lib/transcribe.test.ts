import assert from 'node:assert/strict';
import test from 'node:test';

import { configuredProvider, filenameFor, isAudio, modelFor } from './transcribe.ts';

test('self-hosted is used when one is actually configured, not merely preferred', async () => {
  // A fresh deployment must work without standing up a speech server first.
  assert.equal(configuredProvider({} as never), 'openai');
  assert.equal(configuredProvider({ WHISPER_URL: 'http://whisper:9000' } as never), 'local');

  // An explicit choice always wins over the inference.
  assert.equal(
    configuredProvider({ WHISPER_URL: 'http://whisper:9000', TRANSCRIBE_PROVIDER: 'openai' } as never),
    'openai',
  );
  assert.equal(configuredProvider({ TRANSCRIBE_PROVIDER: 'nonsense' } as never), 'openai');
});

test('each provider reports the model it used, so spend can be attributed', async () => {
  assert.equal(modelFor('openai', {} as never), 'gpt-4o-mini-transcribe');
  assert.equal(modelFor('local', {} as never), 'whisper-local');
  assert.equal(modelFor('openai', { TRANSCRIBE_MODEL: 'whisper' } as never), 'whisper');
});

test('a Telegram voice note keeps an extension the codec can be read from', async () => {
  // Held-to-record notes arrive as Opus in Ogg; the API infers the codec from the name.
  assert.equal(filenameFor('audio/ogg'), 'voice.ogg');
  assert.equal(filenameFor('audio/mpeg'), 'voice.mp3');
  assert.equal(filenameFor('audio/x-m4a'), 'voice.m4a');
  assert.equal(filenameFor(undefined), 'voice.ogg', 'a sane default rather than a failure');
  assert.equal(filenameFor('application/octet-stream'), 'voice.ogg');
});

test('speech is recognised however the platform labels it', async () => {
  assert.ok(isAudio({ mimeType: 'audio/ogg' }));
  assert.ok(isAudio({ mimeType: 'audio/mpeg' }));
  assert.ok(isAudio({ name: 'note.opus' }), 'some attachments arrive with no mime type');
  assert.ok(isAudio({ name: 'memo.M4A' }), 'and the extension may be any case');

  assert.equal(isAudio({ mimeType: 'image/png' }), false);
  assert.equal(isAudio({ mimeType: 'application/pdf', name: 'contract.pdf' }), false);
  assert.equal(isAudio(null), false);
  assert.equal(isAudio(undefined), false);
});

test('audio is recognised from the type field adapters actually send', async () => {
  const { isAudio: audio } = await import('./transcribe.ts');
  // The delivered shape carries a type; requiring a mime type missed every voice note.
  assert.ok(audio({ type: 'audio' }));
  assert.ok(audio({ type: 'voice_note' }));
  assert.equal(audio({ type: 'image' }), false);
});

test('bytes are read however the adapter chose to provide them', async () => {
  const { attachmentBytes } = await import('./transcribe.ts');
  const bytes = new Uint8Array([1, 2, 3]).buffer;

  assert.equal(await attachmentBytes({ data: bytes }), bytes, 'inline data');
  assert.equal(await attachmentBytes({ fetchData: async () => bytes }), bytes, 'a fetcher');

  // Requiring any single one of these is how the first version failed on every note.
  await assert.rejects(() => attachmentBytes({}), /no data/);
});

test('a fetcher that returns nothing falls through rather than throwing early', async () => {
  const { attachmentBytes } = await import('./transcribe.ts');
  const bytes = new Uint8Array([9]).buffer;
  // Present but empty is a real adapter behaviour; the url is still worth trying.
  const result = await attachmentBytes({
    fetchData: async () => undefined as never,
    url: 'data:,',
  }).catch(() => 'threw');
  assert.notEqual(result, 'threw', 'it should try the url before giving up');
  void bytes;
});
