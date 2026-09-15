import { createClient, type Client } from '@libsql/client';

/**
 * Accounts, and the places they can be reached.
 *
 * Built before there is a second user on purpose. Every part of this product that assumes
 * one owner — a single Telegram chat id in the environment, one shared memory resource, a
 * task table with no owner — is cheap to generalise now and expensive to unpick once real
 * people's commitments are in the database.
 *
 * Reaching a user is deliberately separated from being a user. Someone may arrive on
 * Telegram, later prefer WhatsApp, and eventually install an app, without becoming three
 * accounts or losing the history attached to the first one. That is also why the internal
 * id is not a chat id or a phone number: those are addresses, and addresses change.
 */

/** Where a user can be reached. Adding one means an adapter, not a schema change. */
export type ChannelKind = 'telegram' | 'whatsapp' | 'push';

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deleted';

export interface User {
  id: string;
  displayName: string | null;
  /** Per user, never a global default: an international product has no single timezone. */
  timezone: string;
  status: UserStatus;
  createdAt: string;
  deletedAt: string | null;
}

export interface UserChannel {
  id: number;
  userId: string;
  channel: ChannelKind;
  /** Telegram chat id, WhatsApp phone number in E.164, or a device token. */
  externalId: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

let client: Client | undefined;
let ready: Promise<void> | undefined;

function db(): Client {
  client ??= createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  return client;
}

/** The single owner of a pre-multi-user installation. */
export const OWNER_USER_ID = 'owner';

async function init(): Promise<void> {
  ready ??= (async () => {
    await db().execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )
    `);
    await db().execute(`
      CREATE TABLE IF NOT EXISTS user_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        external_id TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (channel, external_id)
      )
    `);
    await db().execute(
      'CREATE INDEX IF NOT EXISTS idx_user_channels_user ON user_channels (user_id)',
    );

    /**
     * Seed the existing installation as one user, so single-user data keeps working and
     * the owner's history is not stranded when the rest of the code starts scoping by
     * account. Their environment-configured Telegram chat becomes their primary channel.
     */
    await db().execute({
      sql: `INSERT OR IGNORE INTO users (id, display_name, timezone, status, created_at)
            VALUES (?, ?, ?, 'active', ?)`,
      args: [OWNER_USER_ID, null, process.env.TIMEZONE || 'UTC', new Date().toISOString()],
    });

    const ownerChat = process.env.TELEGRAM_OWNER_CHAT_ID?.trim();
    if (ownerChat) {
      await db().execute({
        sql: `INSERT OR IGNORE INTO user_channels
                (user_id, channel, external_id, is_primary, verified_at, created_at)
              VALUES (?, 'telegram', ?, 1, ?, ?)`,
        args: [OWNER_USER_ID, ownerChat, new Date().toISOString(), new Date().toISOString()],
      });
    }
  })();
  return ready;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toUser(row: any): User {
  return {
    id: String(row.id),
    displayName: row.display_name ?? null,
    timezone: String(row.timezone ?? 'UTC'),
    status: row.status as UserStatus,
    createdAt: String(row.created_at),
    deletedAt: row.deleted_at ?? null,
  };
}

function toChannel(row: any): UserChannel {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    channel: row.channel as ChannelKind,
    externalId: String(row.external_id),
    isPrimary: Boolean(row.is_primary),
    verifiedAt: row.verified_at ?? null,
  };
}

export async function getUser(id: string): Promise<User | null> {
  await init();
  const result = await db().execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/**
 * The account behind an inbound message.
 *
 * This is the lookup every channel performs on arrival: a Telegram chat id or a WhatsApp
 * phone number identifies an account, or it identifies nobody and the message is ignored.
 */
export async function findUserByChannel(
  channel: ChannelKind,
  externalId: string,
): Promise<User | null> {
  await init();
  const result = await db().execute({
    sql: `SELECT u.* FROM users u
          JOIN user_channels c ON c.user_id = u.id
          WHERE c.channel = ? AND c.external_id = ? AND u.deleted_at IS NULL`,
    args: [channel, externalId],
  });
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/** Where to send this user an unprompted message. */
export async function primaryChannel(userId: string): Promise<UserChannel | null> {
  await init();
  const result = await db().execute({
    sql: `SELECT * FROM user_channels WHERE user_id = ?
          ORDER BY is_primary DESC, id ASC LIMIT 1`,
    args: [userId],
  });
  return result.rows[0] ? toChannel(result.rows[0]) : null;
}

export async function listChannels(userId: string): Promise<UserChannel[]> {
  await init();
  const result = await db().execute({
    sql: 'SELECT * FROM user_channels WHERE user_id = ? ORDER BY is_primary DESC, id ASC',
    args: [userId],
  });
  return result.rows.map(toChannel);
}

export async function createUser(input: {
  id: string;
  displayName?: string;
  timezone?: string;
  status?: UserStatus;
}): Promise<User> {
  await init();
  const result = await db().execute({
    sql: `INSERT INTO users (id, display_name, timezone, status, created_at)
          VALUES (?, ?, ?, ?, ?) RETURNING *`,
    args: [
      input.id,
      input.displayName ?? null,
      input.timezone ?? 'UTC',
      input.status ?? 'invited',
      new Date().toISOString(),
    ],
  });
  return toUser(result.rows[0]);
}

/**
 * Attach a way of reaching a user, or move it if another account claimed it.
 *
 * A phone number reassigned to a new person must not deliver the previous owner's
 * commitments, so `(channel, external_id)` is unique and re-linking transfers it.
 */
export async function linkChannel(input: {
  userId: string;
  channel: ChannelKind;
  externalId: string;
  isPrimary?: boolean;
  verified?: boolean;
}): Promise<UserChannel> {
  await init();
  const now = new Date().toISOString();

  if (input.isPrimary) {
    await db().execute({
      sql: 'UPDATE user_channels SET is_primary = 0 WHERE user_id = ?',
      args: [input.userId],
    });
  }

  const result = await db().execute({
    sql: `INSERT INTO user_channels (user_id, channel, external_id, is_primary, verified_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (channel, external_id) DO UPDATE SET
            user_id = excluded.user_id,
            is_primary = excluded.is_primary,
            verified_at = excluded.verified_at
          RETURNING *`,
    args: [
      input.userId,
      input.channel,
      input.externalId,
      input.isPrimary ? 1 : 0,
      input.verified ? now : null,
      now,
    ],
  });
  return toChannel(result.rows[0]);
}
