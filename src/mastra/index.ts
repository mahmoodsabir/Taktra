import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';
import { nudger } from './agents/nudger';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { addTodoTool, listTodosTool, updateTodoTool } from './tools/todo-tools';
import {
  createEventTool,
  deleteEventTool,
  listEventsTool,
  updateEventTool,
} from './tools/calendar-tools';
import { notifyTool } from './tools/notify-tool';
import { connectTelegram } from './lib/telegram';
import { todosDueForNudge } from './lib/todos';

const timezone = process.env.TIMEZONE || 'UTC';
const DUE_SWEEP_ID = 'due-sweep';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent, nudger },
  tools: {
    startScheduleTool,
    stopScheduleTool,
    addTodoTool,
    listTodosTool,
    updateTodoTool,
    listEventsTool,
    createEventTool,
    updateEventTool,
    deleteEventTool,
    notifyTool,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  schedules: {
    /**
     * Runs before every scheduled fire. Returning `null` skips the fire entirely —
     * no agent run, no model call, no cost — which is what makes a sweep every
     * quarter hour affordable: it only wakes the agent when something is actually due.
     */
    prepare: async ({ schedule }) => {
      /**
       * Cron runs are formulaic and nobody is waiting on the reply, so they take the
       * cheap lane: `flex` bills at Batch rates for slower, best-effort capacity, and
       * low reasoning/verbosity keeps invisible reasoning tokens — billed as output —
       * off a job that is mostly "read two lists and decide whether to speak".
       *
       * These settings are part of the cache key, so they are deliberately identical
       * for every scheduled fire. Varying them per run would fragment the prefix cache
       * and cost more than it saves.
       */
      const cheap = {
        providerOptions: {
          openai: { serviceTier: 'flex', reasoningEffort: 'low', textVerbosity: 'low' },
        },
      };

      if (!schedule.id.endsWith(DUE_SWEEP_ID)) return cheap;

      const due = await todosDueForNudge();
      if (due.length === 0) return null;

      const lines = due.map((todo) => {
        const when = todo.dueAt ? `due ${todo.dueAt}` : `${todo.status}, no due date`;
        return `- [${todo.id}] ${todo.title} (${when})`;
      });
      return {
        ...cheap,
        prompt: `These need attention now:\n${lines.join('\n')}\n\nSend one short Telegram message about them, then mark each one nudged with todo_update.`,
      };
    },
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

/**
 * Standing check-ins.
 *
 * These are threadless, so each fire is an isolated run with no inbound message.
 * The agent reaches the user through the send_telegram tool, and decides for
 * itself whether the current state is worth an interruption at all.
 */
const CHECK_INS = [
  {
    id: 'morning-brief',
    cron: '0 8 * * *',
    prompt:
      "Morning brief. Check open, non-snoozed tasks across every area and the calendar for the next 48 hours. Stay silent unless something is genuinely due or at risk. Batch everything into one short Telegram message: what is on today, and what needs to move. Flag anything time-specific that needs preparing today.",
  },
  {
    id: 'midday-sweep',
    cron: '0 14 * * *',
    prompt:
      'Midday sweep. Check for tasks due today that are still open, and anything on the calendar in the next few hours. Nudge only if something is actually at risk of slipping.',
  },
  {
    id: DUE_SWEEP_ID,
    cron: '*/15 * * * *',
    prompt: 'Placeholder — the prepare hook supplies the real prompt, or skips the fire.',
  },
  {
    id: 'evening-closeout',
    cron: '0 21 * * *',
    prompt:
      "Evening close-out. Ask about anything due today that is still open, so it gets marked done, dropped, or rescheduled rather than left to rot. Also surface anything that has been open a long time with no movement. One message, not several.",
  },
] as const;

/**
 * Reconcile rather than create-once: stored schedules survive restarts, so a
 * plain create would silently keep the cron and timezone from whichever boot
 * happened to run first — including the UTC default from before TIMEZONE was set.
 *
 * Stored ids carry a fixed `agent_` namespace prefix that is **not** derived from the
 * agent they target — `agent_morning-brief` can perfectly well run on `nudger`. Matching
 * on a `<agentId>_<slug>` guess therefore never hits, and every boot would try to create
 * a schedule that already exists. Match on the slug suffix instead.
 */
const NUDGER_ID = 'nudger';

const findStored = (schedules: { id: string }[], slug: string) =>
  schedules.find((schedule) => schedule.id === slug || schedule.id.endsWith(`_${slug}`));

/**
 * The standing check-ins used to run on the main agent. Any copy still targeting it would
 * fire alongside the new one — every check-in twice, the duplicate on the pricier model.
 *
 * Only the four known check-ins are retired. The agent also creates *ad-hoc* schedules on
 * itself through `start_schedule` when the owner asks for a one-off or recurring reminder
 * ("remind me every Friday about X"), and those are the owner's data. An earlier version
 * of this deleted everything bound to `agent` and would have silently destroyed them on
 * the next boot.
 */
const checkInSlugs = new Set<string>(CHECK_INS.map((checkIn) => checkIn.id));
for (const stale of await mastra.schedules.list({ agentId: 'agent' })) {
  const slug = stale.id.replace(/^agent_/, '');
  if (!checkInSlugs.has(slug)) continue;

  await mastra.schedules.delete(stale.id).catch((error) => {
    mastra.getLogger().warn('Could not remove a check-in left on the old agent', {
      id: stale.id,
      error,
    });
  });
}

const stored = await mastra.schedules.list({ agentId: NUDGER_ID });

for (const checkIn of CHECK_INS) {
  const existing = findStored(stored, checkIn.id);
  const desired = { cron: checkIn.cron, timezone, prompt: checkIn.prompt };

  if (existing) {
    await mastra.schedules.update(existing.id, desired);
  } else {
    await mastra.schedules.create({ id: checkIn.id, agentId: NUDGER_ID, ...desired });
  }
}

// Mastra has registered its channel handlers by now, so it is safe to begin polling.
// Keep the HTTP server up if Telegram is temporarily unreachable; polling can recover
// after the service is restarted.
void connectTelegram().catch((error) => {
  mastra.getLogger().error('Telegram polling failed; messages are unavailable', { error });
});
