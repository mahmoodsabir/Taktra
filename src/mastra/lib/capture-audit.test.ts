import assert from 'node:assert/strict';
import test from 'node:test';

import { looksLikeCommitment } from './capture-audit.ts';

test('catches the phrasings that were actually dropped in production', () => {
  // Both of these produced no task at all, and left no trace that they had been missed.
  assert.ok(looksLikeCommitment('Tomorrow 4pm abood job'));
  assert.ok(
    looksLikeCommitment('Remind me tomorrow\nAbout\nhttps://instagram.com/reel/abc\n2pm'),
  );
});

test('catches explicit requests regardless of wording', () => {
  for (const text of [
    'remind me to call the accountant',
    "don't let me forget the invoice",
    'I need to renew the domain',
    'remember to book the flight',
    'add a task for the gym',
  ]) {
    assert.ok(looksLikeCommitment(text), text);
  }
});

test('ignores conversation, questions, and commands', () => {
  for (const text of [
    'hi',
    'how are you?',
    'what do we have on our bucket?',
    'thanks',
    'he just arrived',
    '/start',
    '/getid',
    '',
    '   ',
  ]) {
    assert.equal(looksLikeCommitment(text), false, text);
  }
});

test('a bare time reference alone is not enough', () => {
  // Over-reporting is cheap, but "tomorrow?" on its own is conversation.
  assert.equal(looksLikeCommitment('tomorrow?'), false);
  assert.equal(looksLikeCommitment('2pm'), false);
});
