import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthExpired } from './google-auth-detect.ts';

test('recognises an expired Google authorisation in the shapes googleapis throws', () => {
  // Seen in production when the refresh token hit Google's 7-day unverified-app limit.
  assert.ok(isAuthExpired(new Error('invalid_grant')));
  assert.ok(isAuthExpired(new Error('Token has been expired or revoked.')));
  assert.ok(isAuthExpired(new Error('unauthorized_client')));
  assert.ok(isAuthExpired('invalid_grant'));

  const wrapped = Object.assign(new Error('Request failed'), {
    response: { data: { error: 'invalid_grant', error_description: 'Bad Request' } },
  });
  assert.ok(isAuthExpired(wrapped), 'the reason is often only in the response body');
});

test('does not mistake ordinary failures for an expired authorisation', () => {
  // Misreading these would tell the owner to re-authorise when nothing is wrong with auth.
  assert.equal(isAuthExpired(new Error('Not Found')), false);
  assert.equal(isAuthExpired(new Error('Rate Limit Exceeded')), false);
  assert.equal(isAuthExpired(new Error('read ETIMEDOUT')), false);
  assert.equal(isAuthExpired(new Error('Invalid time range')), false);
});
