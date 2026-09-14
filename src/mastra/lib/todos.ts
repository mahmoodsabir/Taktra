import { createClient, type Client } from '@libsql/client';

export type TodoStatus = 'open' | 'blocked' | 'done' | 'dropped';
export type TodoContext = 'personal' | 'work' | 'health' | 'family' | 'growth' | 'admin';
export type TodoPriority = 'low' | 'normal' | 'high';

export interface Todo {
  id: number;
  title: string;
  notes: string | null;
  context: TodoContext;
  priority: TodoPriority;
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
        context TEXT NOT NULL DEFAULT 'personal',
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        due_at TEXT,
        snoozed_until TEXT,
        last_nudged_at TEXT,
        nudged_for_due_at TEXT,
        status_reason TEXT,
        minimum_viable_action TEXT,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `)
    .then(async () => {
      const columnsToAdd = [
        'nudged_for_due_at',
        'status_reason',
        'minimum_viable_action',
        'escalation_level',
      ];
      for (const column of columnsToAdd) {
        await db()
          .execute(`ALTER TABLE todos ADD COLUMN ${column} ${column === 'escalation_level' ? 'INTEGER NOT NULL DEFAULT 0' : 'TEXT'}`)
          .catch(() => undefined);
      }
    });
  return ready;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTodo(row: any): Todo {
  return {
    id: Number(row.id),
    title: String(row.title),
    notes: row.notes ?? null,
    context: row.context,
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
    | 'context'
    | 'priority'
    | 'lastNudgedAt'
    | 'statusReason'
    | 'minimumViableAction'
    | 'escalationLevel'
  >,
  now = new Date(),
): number {
  let level = todo.escalationLevel ?? 0;

  if (todo.status === 'blocked') level = Math.max(level, 1);
  if (todo.statusReason && todo.statusReason.toLowerCase().includes('busy')) level = Math.max(level, 1);
  if (todo.minimumViableAction) level = Math.max(level, 1);

  if (todo.dueAt) {
    const dueAt = new Date(todo.dueAt);
    const hoursLate = (now.getTime() - dueAt.getTime()) / (60 * 60 * 1000);
    if (hoursLate > 12) level = Math.max(level, 2);
    if (hoursLate > 24) level = Math.max(level, 3);
  }

  if (todo.lastNudgedAt) {
    const lastNudged = new Date(todo.lastNudgedAt);
    const hoursSinceNudge = (now.getTime() - lastNudged.getTime()) / (60 * 60 * 1000);
    if (hoursSinceNudge > 12 && todo.status !== 'done') level = Math.max(level, 2);
    if (hoursSinceNudge > 24 && todo.status !== 'done') level = Math.max(level, 3);
  }

  if (todo.priority === 'high' && todo.status === 'open' && todo.dueAt && new Date(todo.dueAt) <= now) {
    level = Math.max(level, 2);
  }

  return Math.min(level, 4);
}

export async function addTodo(input: {
  title: string;
  notes?: string;
  context?: TodoContext;
  priority?: TodoPriority;
  dueAt?: string;
  minimumViableAction?: string;
}): Promise<Todo> {
  await init();
  const result = await db().execute({
    sql: `INSERT INTO todos (title, notes, context, priority, status, due_at, minimum_viable_action, created_at)
          VALUES (?, ?, ?, ?, 'open', ?, ?, ?) RETURNING *`,
    args: [
      input.title,
      input.notes ?? null,
      input.context ?? 'personal',
      input.priority ?? 'normal',
      input.dueAt ? toUtc(input.dueAt) : null,
      input.minimumViableAction ?? null,
      new Date().toISOString(),
    ],
  });
  return toTodo(result.rows[0]);
}

export async function listTodos(filter: {
  status?: TodoStatus;
  context?: TodoContext;
  dueBefore?: string;
  includeSnoozed?: boolean;
  limit?: number;
} = {}): Promise<Todo[]> {
  await init();
  const where: string[] = [];
  const args: unknown[] = [];

  where.push('status = ?');
  args.push(filter.status ?? 'open');

  if (filter.context) {
    where.push('context = ?');
    args.push(filter.context);
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

export async function updateTodo(
  id: number,
  patch: {
    title?: string;
    notes?: string;
    context?: TodoContext;
    priority?: TodoPriority;
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
  if (patch.context !== undefined) push('context', patch.context);
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
    push('status', patch.status);
    push('completed_at', patch.status === 'done' ? new Date().toISOString() : null);
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

/**
 * Tasks that have come due and have not been nudged since they came due.
 *
 * The standing check-ins only run a few times a day, so a task due at 11:00 would
 * otherwise be mentioned at breakfast and then not again until the afternoon sweep.
 * `last_nudged_at < due_at` is what keeps this to one ping per task rather than one
 * every time the sweep runs.
 */
export async function todosDueForNudge(withinMinutes = 15): Promise<Todo[]> {
  await init();
  const now = new Date();
  const result = await db().execute({
    sql: `SELECT * FROM todos
          WHERE status IN ('open', 'blocked')
            AND (
              (due_at IS NOT NULL AND due_at <= ?)
              OR status = 'blocked'
            )
            AND (snoozed_until IS NULL OR snoozed_until <= ?)
            AND (nudged_for_due_at IS NULL OR nudged_for_due_at <> due_at)
          ORDER BY due_at ASC`,
    args: [
      new Date(now.getTime() + withinMinutes * 60_000).toISOString(),
      now.toISOString(),
    ],
  });

  return result.rows
    .map(toTodo)
    .filter((todo) => {
      const level = computeEscalationLevel(todo, now);
      return level >= 1 || !!todo.dueAt && new Date(todo.dueAt) <= new Date(now.getTime() + withinMinutes * 60_000);
    });
}
