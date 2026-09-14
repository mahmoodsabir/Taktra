import { google, type calendar_v3 } from 'googleapis';
import { isAuthExpired } from './google-auth-detect';

const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;

let cached: calendar_v3.Calendar | undefined;

/**
 * Google Calendar client authorized as the account that ran `npm run google:auth`.
 *
 * Uses an installed-app OAuth2 refresh token rather than a service account, because
 * a personal Gmail calendar cannot be shared with a service account without a
 * Workspace domain and delegated authority.
 */
export function calendar(): calendar_v3.Calendar {
  if (cached) return cached;

  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Google Calendar is not configured. Missing ${missing.join(', ')}. Run "npm run google:auth" to set it up.`,
    );
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5858/oauth2callback',
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  cached = google.calendar({ version: 'v3', auth });
  return cached;
}

/** A message the agent can relay verbatim when the connection has lapsed. */
export const RECONNECT_MESSAGE =
  'Google Calendar needs reconnecting — the authorisation expired, which happens about every 7 days while the app is unverified. Run "npm run google:auth" and paste the new GOOGLE_REFRESH_TOKEN into .env. Until then I cannot see or change the calendar, so treat anything I say about it as unverified.';

/**
 * Run a Calendar call, turning an expired authorisation into an instruction.
 *
 * Without this the raw `invalid_grant` reaches the model, which has historically decided
 * to carry on without calendar data rather than say anything.
 */
export async function withCalendar<T>(run: (api: calendar_v3.Calendar) => Promise<T>): Promise<T> {
  try {
    return await run(calendar());
  } catch (error) {
    if (isAuthExpired(error)) throw new Error(RECONNECT_MESSAGE);
    throw error;
  }
}

export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

/** IANA timezone used when the caller does not supply one. */
export const TIMEZONE = process.env.TIMEZONE || 'UTC';

/** Trim a Google event down to the fields the agent actually reasons about. */
export function summarizeEvent(event: calendar_v3.Schema$Event) {
  return {
    id: event.id,
    title: event.summary ?? '(no title)',
    description: event.description ?? null,
    location: event.location ?? null,
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    allDay: Boolean(event.start?.date),
    attendees: event.attendees?.map((a) => a.email).filter(Boolean) ?? [],
    hangoutLink: event.hangoutLink ?? null,
    status: event.status ?? null,
  };
}
