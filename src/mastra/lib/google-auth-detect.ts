/**
 * Whether a Google failure means the connection needs re-authorising.
 *
 * Kept free of imports so it can be exercised directly. The consent screen is in Testing,
 * and Google expires refresh tokens from unverified apps after exactly seven days; lifting
 * that needs full verification, because Calendar is a sensitive scope. So this is a weekly
 * event, and what matters is that it is never mistaken for a working calendar.
 */
export function isAuthExpired(error: unknown): boolean {
  const parts = [error instanceof Error ? error.message : String(error)];
  if (error && typeof error === 'object' && 'response' in error) {
    try {
      parts.push(JSON.stringify((error as { response?: unknown }).response));
    } catch {
      // A response that will not serialise tells us nothing; the message still might.
    }
  }
  return /invalid_grant|invalid_rapt|Token has been expired or revoked|unauthorized_client/i.test(
    parts.join(' '),
  );
}
