import { createClient, type Client } from '@libsql/client';
import { OWNER_USER_ID } from './users.ts';

/**
 * `blocked` and `stalled` are deliberately separate.
 *
 * `blocked` waits on someone else, so chasing the owner achieves nothing and the nudge
 * should offer to chase the other party instead. `stalled` is stuck on the owner, which
 * is exactly what this product exists to push on. They earn different cadences, so one
 * status carrying both (discriminated by a free-text reason) would collapse that.
 *
 * `note` is a fact worth keeping that is not a commitment. It is never nudged.
 */
export type TodoStatus = 'open' | 'blocked' | 'stalled' | 'note' | 'done' | 'dropped';
export type TodoArea = 'personal' | 'work' | 'health' | 'family' | 'growth' | 'admin';

/**
 * How often a commitment comes back.
 *
 * Deliberately a small vocabulary rather than cron or RRULE. The owner says "every
 * Friday", not "0 10 * * 5", and a recurring commitment is still one commitment — closing
 * an occurrence rolls it to the next rather than ending it. The alternative in use before
 * this was an ad-hoc schedule alongside a task, which left a live schedule firing forever
 * once the task was closed.
 */
export type TodoRecurrence = 'daily' | 'weekly' | 'monthly';
export type TodoPriority = 'low' | 'normal' | 'high';

export interface Todo {
  id: number;
  /** The account this commitment belongs to. */
  userId: string;
  title: string;
  notes: string | null;
  area: TodoArea;
  priority: TodoPriority;
  recurrence: TodoRecurrence | null;
  status: TodoStatus;
  dueAt: string | null;
  snoozedUntil: string | null;
  lastNudgedAt: string | null;
  statusReason: string | null;
  minimumViableAction: string | null;
  escalationLevel: number;
  createdAt: string;
  completedAt: string | null;
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

async function init(): Promise<void> {
  ready ??= db()
    .execute(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT,
        area TEXT NOT NULL DEFAULT 'personal',
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        due_at TEXT,
        snoozed_until TEXT,
        last_nudged_at TEXT,
        nudged_for_due_at TEXT,
        status_reason TEXT,
        minimum_viable_action TEXT,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT,
        user_id TEXT NOT NULL DEFAULT 'owner',
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `)
    .then(async () => {
      // A log of messages that looked like commitments but produced no task. Separate
      // from `todos` on purpose: these are suspected failures, not commitments, and must
      // never appear in anything the agent reads back to the owner as their list.
      await db()
        .execute(`
          CREATE TABLE IF NOT EXISTS capture_misses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            occurred_at TEXT NOT NULL
          )
        `)
        .catch(() => undefined);

      await db()
        .execute('CREATE INDEX IF NOT EXISTS idx_todos_user ON todos (user_id, status)')
        .catch(() => undefined);

      // Legacy rows used `context` for the life area, which collided with both
      // "bounded context" and "context window". Renaming is a no-op once applied.
      await db().execute('ALTER TABLE todos RENAME COLUMN context TO area').catch(() => undefined);
      await db().execute("ALTER TABLE todos ADD COLUMN area TEXT NOT NULL DEFAULT 'personal'").catch(() => undefined);

      const columnsToAdd = [
        'nudged_for_due_at',
        'status_reason',
        'minimum_viable_action',
        'escalation_level',
        'recurrence',
        'user_id',
      ];
      for (const column of columnsToAdd) {
        const type =
          column === 'escalation_level'
            ? 'INTEGER NOT NULL DEFAULT 0'
            : column === 'user_id'
              ? // Existing rows predate accounts and all belong to the single owner.
                `TEXT NOT NULL DEFAULT '${OWNER_USER_ID}'`
              : 'TEXT';
        await db().execute(`ALTER TABLE todos ADD COLUMN ${column} ${type}`).catch(() => undefined);
      }
    });
  return ready;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTodo(row: any): Todo {
  return {
    id: Number(row.id),
    userId: String(row.user_id ?? OWNER_USER_ID),
    title: String(row.title),
    notes: row.notes ?? null,
    area: row.area,
    recurrence: row.recurrence ?? null,
    priority: row.priority,
    status: row.status,
    dueAt: row.due_at ?? null,
    snoozedUntil: row.snoozed_until ?? null,
    lastNudgedAt: row.last_nudged_at ?? null,
    statusReason: row.status_reason ?? null,
    minimumViableAction: row.minimum_viable_action ?? null,
    escalationLevel: Number(row.escalation_level ?? 0),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ?? null,
  };
}

/**
 * Normalize a datetime to a UTC ISO string.
 *
 * Due dates are compared with SQL string comparison, which is only correct when
 * every stored value shares one offset — "2026-09-01T23:00:00+03:00" sorts after
 * "2026-09-01T21:00:00Z" as text while being two hours earlier in real time.
 */
function toUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime: "${value}". Use ISO 8601, e.g. 2026-09-01T17:00:00+03:00.`);
  }
  return date.toISOString();
}

export function computeEscalationLevel(
  todo: Pick<
    Todo,
    | 'status'
    | 'dueAt'
    | 'area'
    | 'priority'
    | 'lastNudgedAt'
    | 'statusReason'
    | 'minimumViableAction'
    | 'escalationLevel'
  >,
  now = new Date(),
): number {
  let level = todo.escalationLevel ?? 0;

  // `blocked` waits on someone else, so it is surfaced but never escalated — turning up
  // the pressure on the owner for something outside their control is just noise.
  if (todo.status === 'blocked') level = Math.max(level, 1);
  if (todo.status === 'stalled') level = Math.max(level, 2);
  if (todo.statusReason && todo.statusReason.toLowerCase().includes('busy')) level = Math.max(level, 1);
  if (todo.minimumViableAction) level = Math.max(level, 1);

  if (todo.dueAt) {
    const dueAt = new Date(todo.dueAt);
    const hoursLate = (now.getTime() - dueAt.getTime()) / (60 * 60 * 1000);
    if (hoursLate > 12) level = Math.max(level, 2);
    if (hoursLate > 24) level = Math.max(level, 3);
  }

  // Silence escalates only what the owner can actually act on.
  const escalatesOnSilence =
    todo.status !== 'done' && todo.status !== 'dropped' && todo.status !== 'blocked' && todo.status !== 'note';
  if (todo.lastNudgedAt && escalatesOnSilence) {
    const lastNudged = new Date(todo.lastNudgedAt);
    const hoursSinceNudge = (now.getTime() - lastNudged.getTime()) / (60 * 60 * 1000);
    if (hoursSinceNudge > 12) level = Math.max(level, 2);
    if (hoursSinceNudge > 24) level = Math.max(level, 3);
  }

  if (todo.priority === 'high' && todo.status === 'open' && todo.dueAt && new Date(todo.dueAt) <= now) {
    level = Math.max(level, 2);
  }

  return Math.min(level, 4);
}

export async function addTodo(input: {
  /** Defaults to the single owner until sign-up exists. */
  userId?: string;
  title: string;
  notes?: string;
  area?: TodoArea;
  priority?: TodoPriority;
  recurrence?: TodoRecurrence;
  dueAt?: string;
  minimumViableAction?: string;
}): Promise<Todo> {
  await init();
  const result = await db().execute({
    sql: `INSERT INTO todos (user_id, title, notes, area, priority, status, due_at, minimum_viable_action, recurrence, created_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?) RETURNING *`,
    args: [
      input.userId ?? OWNER_USER_ID,
      input.title,
      input.notes ?? null,
      input.area ?? 'personal',
      input.priority ?? 'normal',
      input.dueAt ? toUtc(input.dueAt) : null,
      input.minimumViableAction ?? null,
      input.recurrence ?? null,
      new Date().toISOString(),
    ],
  });
  return toTodo(result.rows[0]);
}

export async function listTodos(filter: {
  /** Defaults to the single owner. Every read is scoped: one user must never see another's. */
  userId?: string;
  status?: TodoStatus;
  area?: TodoArea;
  dueBefore?: string;
  includeSnoozed?: boolean;
  limit?: number;
} = {}): Promise<Todo[]> {
  await init();
  const where: string[] = [];
  const args: unknown[] = [];

  where.push('user_id = ?');
  args.push(filter.userId ?? OWNER_USER_ID);

  where.push('status = ?');
  args.push(filter.status ?? 'open');

  if (filter.area) {
    where.push('area = ?');
    args.push(filter.area);
  }
  if (filter.dueBefore) {
    where.push('due_at IS NOT NULL AND due_at <= ?');
    args.push(toUtc(filter.dueBefore));
  }
  if (!filter.includeSnoozed) {
    where.push('(snoozed_until IS NULL OR snoozed_until <= ?)');
    args.push(new Date().toISOString());
  }

  args.push(filter.limit ?? 100);
  const result = await db().execute({
    sql: `SELECT * FROM todos WHERE ${where.join(' AND ')}
          ORDER BY (due_at IS NULL), due_at ASC,
                   CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                   id ASC
          LIMIT ?`,
    args: args as never[],
  });
  return result.rows.map(toTodo);
}

/**
 * The next time a recurring commitment comes due, counted from its last due time.
 *
 * Advancing from the *due* time rather than from now keeps a weekly Friday task on
 * Fridays even when it is closed out on the Sunday. If it has been missed for several
 * cycles, it rolls forward until it is in the future, so a task neglected for a month
 * comes back due next week rather than four times at once.
 */
export function nextOccurrence(
  dueAt: string,
  recurrence: TodoRecurrence,
  now = new Date(),
): string {
  const next = new Date(dueAt);
  if (Number.isNaN(next.getTime())) throw new Error(`Invalid dueAt: "${dueAt}"`);

  const advance = () => {
    if (recurrence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
    else if (recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
    else {
      // Keep the day of month, but never roll a 31st into the 1st of the month after.
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const lastDay = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(day, lastDay));
    }
  };

  advance();
  while (next.getTime() <= now.getTime()) advance();
  return next.toISOString();
}

export async function updateTodo(
  id: number,
  patch: {
    title?: string;
    notes?: string;
    area?: TodoArea;
    priority?: TodoPriority;
    recurrence?: TodoRecurrence | null;
    status?: TodoStatus;
    dueAt?: string | null;
    snoozedUntil?: string | null;
    statusReason?: string | null;
    minimumViableAction?: string | null;
    escalationLevel?: number;
    markNudged?: boolean;
  },
): Promise<Todo | null> {
  await init();
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    args.push(value);
  };

  if (patch.title !== undefined) push('title', patch.title);
  if (patch.notes !== undefined) push('notes', patch.notes);
  if (patch.area !== undefined) push('area', patch.area);
  if (patch.recurrence !== undefined) push('recurrence', patch.recurrence);
  if (patch.priority !== undefined) push('priority', patch.priority);
  if (patch.dueAt !== undefined) push('due_at', patch.dueAt === null ? null : toUtc(patch.dueAt));
  if (patch.snoozedUntil !== undefined)
    push('snoozed_until', patch.snoozedUntil === null ? null : toUtc(patch.snoozedUntil));
  if (patch.statusReason !== undefined) push('status_reason', patch.statusReason);
  if (patch.minimumViableAction !== undefined)
    push('minimum_viable_action', patch.minimumViableAction);
  if (patch.escalationLevel !== undefined) push('escalation_level', patch.escalationLevel);
  if (patch.markNudged) {
    push('last_nudged_at', new Date().toISOString());
    // Records the due time this nudge was for, so one nudge fires per due time and a
    // reschedule earns a fresh one.
    sets.push('nudged_for_due_at = due_at');
  }
  if (patch.status !== undefined) {
    /**
     * A recurring commitment is one commitment, not a stream of them. Marking an
     * occurrence done rolls it to the next due time and reopens it, so there is a single
     * row to close out and no schedule left running once it is finally dropped.
     *
     * Only `done` rolls forward. `dropped` ends the commitment outright, which is how the
     * owner stops a recurrence.
     */
    const current = await getTodo(id);
    if (patch.status === 'done' && current?.recurrence && current.dueAt) {
      push('status', 'open');
      push('completed_at', null);
      push('due_at', nextOccurrence(current.dueAt, current.recurrence));
      // A fresh due time earns a fresh nudge.
      sets.push('nudged_for_due_at = NULL');
    } else {
      push('status', patch.status);
      push('completed_at', patch.status === 'done' ? new Date().toISOString() : null);
    }
  }

  if (sets.length === 0) return getTodo(id);

  args.push(id);
  const result = await db().execute({
    sql: `UPDATE todos SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
    args: args as never[],
  });
  return result.rows[0] ? toTodo(result.rows[0]) : null;
}

export async function getTodo(id: number): Promise<Todo | null> {
  await init();
  const result = await db().execute({ sql: 'SELECT * FROM todos WHERE id = ?', args: [id] });
  return result.rows[0] ? toTodo(result.rows[0]) : null;
}

/** How long each status waits between nudges when it has no due time of its own. */
export const NUDGE_COOLDOWN_HOURS = {
  /** Stuck on the owner. Chasing is the entire point, so chase daily. */
  stalled: 24,
  /** Waiting on someone else. Surface it, but not every day. */
  blocked: 72,
} as const;

/**
 * Tasks worth nudging right now.
 *
 * Three independent branches, each with its own dedupe:
 *
 * - **due time** — one nudge per due time, tracked by `nudged_for_due_at`. A reschedule
 *   earns a fresh one.
 * - **stalled** / **blocked** — no due time to key off, so these dedupe on a
 *   `last_nudged_at` cooldown instead.
 *
 * The cooldown is what makes an undated task terminate. The previous version selected
 * every `blocked` row unconditionally and deduped only on `nudged_for_due_at = due_at`;
 * for a row with no due date that assignment writes NULL, so the row re-selected on
 * every sweep forever — 96 agent runs a day off a single blocked task.
 *
 * `note` is absent from the status list by design: a note is a fact, not a commitment.
 */
export async function todosDueForNudge(withinMinutes = 15, userId?: string): Promise<Todo[]> {
  await init();
  const now = new Date();
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const result = await db().execute({
    sql: `SELECT * FROM todos
          WHERE (? IS NULL OR user_id = ?)
            AND status IN ('open', 'blocked', 'stalled')
            AND (snoozed_until IS NULL OR snoozed_until <= ?)
            AND (
              (due_at IS NOT NULL AND due_at <= ?
                AND (nudged_for_due_at IS NULL OR nudged_for_due_at <> due_at))
              OR (status = 'stalled' AND (last_nudged_at IS NULL OR last_nudged_at <= ?))
              OR (status = 'blocked' AND (last_nudged_at IS NULL OR last_nudged_at <= ?))
            )
          ORDER BY (due_at IS NULL), due_at ASC`,
    args: [
      userId ?? null,
      userId ?? null,
      now.toISOString(),
      new Date(now.getTime() + withinMinutes * 60_000).toISOString(),
      hoursAgo(NUDGE_COOLDOWN_HOURS.stalled),
      hoursAgo(NUDGE_COOLDOWN_HOURS.blocked),
    ],
  });

  return result.rows
    .map(toTodo)
    .filter((todo) => {
      const level = computeEscalationLevel(todo, now);
      return level >= 1 || !!todo.dueAt && new Date(todo.dueAt) <= new Date(now.getTime() + withinMinutes * 60_000);
    });
}

/** How many commitments exist in total, used to detect a turn that captured nothing. */
export async function countAllTodos(userId: string = OWNER_USER_ID): Promise<number> {
  await init();
  const result = await db().execute({
    sql: 'SELECT count(*) AS n FROM todos WHERE user_id = ?',
    args: [userId],
  });
  return Number((result.rows[0] as unknown as { n: number | bigint })?.n ?? 0);
}

/**
 * Record a message that looked like a commitment but produced no task.
 *
 * Never surfaced to the owner in the moment — the heuristic is deliberately blunt and
 * would be wrong often enough to be irritating. It exists so that "it did not capture
 * that" is answerable afterwards instead of being invisible, which is how two real
 * reminders were lost without either of us noticing.
 */
export async function recordCaptureMiss(message: string): Promise<void> {
  await init();
  await db().execute({
    sql: 'INSERT INTO capture_misses (message, occurred_at) VALUES (?, ?)',
    // Truncated: enough to recognise what was missed, without keeping a second copy of
    // every long message the owner ever sent.
    args: [message.slice(0, 500), new Date().toISOString()],
  });
}

export interface CaptureMiss {
  id: number;
  message: string;
  occurredAt: string;
}

/** Suspected missed captures, newest first. */
export async function listCaptureMisses(limit = 50): Promise<CaptureMiss[]> {
  await init();
  const result = await db().execute({
    sql: 'SELECT * FROM capture_misses ORDER BY id DESC LIMIT ?',
    args: [limit],
  });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    message: String(row.message),
    occurredAt: String(row.occurred_at),
  }));
}
