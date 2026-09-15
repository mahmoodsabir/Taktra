import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { addTodo, listTodos, updateTodo, type TodoArea, type TodoPriority } from '../lib/todos';

const areaEnum = z.enum(['personal', 'work', 'health', 'family', 'growth', 'admin']);
const priorityEnum = z.enum(['low', 'normal', 'high']);
const statusEnum = z.enum(['open', 'blocked', 'stalled', 'note', 'done', 'dropped']);
const recurrenceEnum = z.enum(['daily', 'weekly', 'monthly']);

export const addTodoTool = createTool({
  id: 'todo_add',
  description:
    'Log a new task or commitment. Use this whenever the user mentions something they need to do, even in passing.',
  inputSchema: z.object({
    title: z.string().describe('Short imperative summary, e.g. "Send Q3 invoice to Acme".'),
    notes: z.string().optional().describe('Any extra detail worth remembering.'),
    area: areaEnum.default('personal').describe('Life area: personal, work, health, family, growth, or admin.'),
    priority: priorityEnum.default('normal'),
    dueAt: z
      .string()
      .optional()
      .describe('ISO 8601 datetime the task is due. Omit if the user gave no deadline.'),
    recurrence: recurrenceEnum
      .optional()
      .describe(
        'Set when the commitment repeats — "every Friday" is weekly, "every morning" daily, "every month" monthly. Requires dueAt, which sets the first occurrence and the time of day. Marking it done rolls it to the next occurrence instead of closing it, so do not create a separate schedule for it.',
      ),
    minimumViableAction: z
      .string()
      .optional()
      .describe('A reduced version of the task that can still move it forward when the user is overloaded, busy, or lazy.'),
  }),
  execute: async ({ title, notes, area, priority, dueAt, recurrence, minimumViableAction }) =>
    addTodo({
      title,
      notes,
      area: area as TodoArea,
      priority: priority as TodoPriority,
      dueAt,
      recurrence,
      minimumViableAction,
    }),
});

export const listTodosTool = createTool({
  id: 'todo_list',
  description:
    'List tracked tasks. Defaults to open, non-snoozed tasks sorted by due date then priority.',
  inputSchema: z.object({
    status: statusEnum.default('open'),
    area: areaEnum.optional().describe('Filter by life area: personal, work, health, family, growth, or admin.'),
    dueBefore: z
      .string()
      .optional()
      .describe('ISO 8601 datetime. Only return tasks due at or before this moment.'),
    includeSnoozed: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(25),
  }),
  execute: async ({ status, area, dueBefore, includeSnoozed, limit }) => {
    const todos = await listTodos({ status, area, dueBefore, includeSnoozed, limit });
    return { count: todos.length, todos };
  },
});

export const updateTodoTool = createTool({
  id: 'todo_update',
  description:
    'Update a task: close it out, drop it, reschedule it, snooze it, or record that you just nudged the user about it.',
  inputSchema: z.object({
    id: z.number().int().describe('Task id from todo_add or todo_list.'),
    title: z.string().optional(),
    notes: z.string().optional(),
    area: areaEnum.optional(),
    priority: priorityEnum.optional(),
    recurrence: recurrenceEnum
      .nullable()
      .optional()
      .describe('Make the commitment repeat, or null to stop it repeating.'),
    status: statusEnum
      .optional()
      .describe(
        'Pick the one that matches who is holding it up. "blocked" = waiting on someone else, so the user cannot move it alone. "stalled" = stuck on the user themselves, through overwhelm, avoidance, or drift. "note" = a fact worth keeping that is not a commitment and must never be nudged. "done" when finished — on a recurring commitment this rolls it to the next occurrence rather than closing it. "dropped" when abandoned, which is how a recurring commitment is stopped for good.',
      ),
    dueAt: z.string().nullable().optional().describe('ISO 8601 datetime, or null to clear.'),
    snoozedUntil: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 datetime to stay quiet until, or null to clear.'),
    statusReason: z
      .string()
      .nullable()
      .optional()
      .describe('Why the task is blocked, delayed, or moved; useful when the user is overloaded, distracted, or busy with life.'),
    minimumViableAction: z
      .string()
      .nullable()
      .optional()
      .describe('The smallest meaningful next action that still makes progress if the user is exhausted, lazy, or caught up in something else.'),
    escalationLevel: z
      .number()
      .int()
      .min(0)
      .max(4)
      .optional()
      .describe('How far the accountability follow-up has escalated, from 0 (normal) to 4 (final close-out prompt).'),
    markNudged: z
      .boolean()
      .default(false)
      .describe('Set true right after reminding the user, so follow-ups do not repeat too soon.'),
  }),
  execute: async ({ id, ...patch }) => {
    const todo = await updateTodo(id, patch as Parameters<typeof updateTodo>[1]);
    if (!todo) throw new Error(`No task with id ${id}.`);
    return todo;
  },
});
