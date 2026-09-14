import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { telegramAdapter } from '../lib/telegram';
import { startScheduleTool, stopScheduleTool } from '../tools/schedule-tools';
import { addTodoTool, listTodosTool, updateTodoTool } from '../tools/todo-tools';
import {
  createEventTool,
  deleteEventTool,
  listEventsTool,
  updateEventTool,
} from '../tools/calendar-tools';
import { notifyTool } from '../tools/notify-tool';
import { notifyOwner } from '../lib/notify';

const timezone = process.env.TIMEZONE || 'UTC';

/**
 * Models are overridable from `.env` so a swap needs no code change. The `provider/model`
 * form is Mastra's routing prefix, so these can point at a non-OpenAI provider too.
 */
const agentModel = process.env.AGENT_MODEL || 'openai/gpt-5.6-terra';
const memoryModel = process.env.MEMORY_MODEL || 'openai/gpt-5.6-luna';

/** The owner's own memory: Telegram, and scheduled runs acting on their behalf. */
export const OWNER_RESOURCE_ID = 'agent';
/** Development sessions in Studio, kept out of the owner's long-term memory. */
export const STUDIO_RESOURCE_ID = 'studio';

/**
 * One Memory instance, shared with the nudger agent.
 *
 * Both agents speak to the same person about the same commitments, so they must read and
 * write one working-memory document and one observation record. Two Memory instances
 * would silently fork the owner's history down the middle.
 */
export const sharedMemory = new Memory({
  options: {
    // `true` resolves to the agent's own model, so every new thread would write an
    // 80-character title at main-model rates.
    generateTitle: { model: memoryModel },
    workingMemory: {
      enabled: true,
      scope: 'resource',
      template: `# User

- **Name**:
- **Timezone**:
- **Working hours**:
- **Business / role**:

# Standing context

- **Recurring commitments**:
- **People who come up often**:
- **Current priorities**:

# Preferences

- **How and when they want to be nudged**:
- **Topics to stay quiet about**:
`,
    },
    observationalMemory: {
      model: memoryModel,
      /**
       * The defaults (30k message tokens, 40k observation tokens) are sized for far
       * chattier traffic. At this volume they meant nothing was observed for eleven
       * days. Lower thresholds both shrink the per-step payload and make long-term
       * recall actually happen.
       */
      observation: { messageTokens: 8_000 },
      reflection: { observationTokens: 10_000 },
      /**
       * Thread scope (the default) throws when a run has no thread, which is every
       * scheduled check-in — they fire threadless, so the whole reminder path died
       * before it reached the model. Resource scope also matches the single shared
       * resourceId, so observations carry across Studio and Telegram.
       */
      scope: 'resource',
    },
  },});

/**
 * Turn a crash into a sentence the owner can act on.
 *
 * Without this the raw failure is what lands in the chat — "You have no credits
 * remaining", "read ETIMEDOUT" — which reads as the agent breaking rather than telling
 * them something. Worse, a silent failure looks exactly like being ignored, and an
 * accountability agent that appears to ignore you is worse than no agent.
 */
async function handleOrApologize<TThread, TMessage>(
  thread: TThread,
  message: TMessage,
  defaultHandler: (thread: TThread, message: TMessage) => Promise<unknown>,
): Promise<void> {
  try {
    await defaultHandler(thread, message);
    return;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const explain = /credit|quota|billing|insufficient/i.test(text)
      ? "I'm out of API credit, so I can't think right now. Top it up and say that again — I have not saved this one."
      : /timeout|etimedout|econnreset|fetch failed|network/i.test(text)
        ? "I couldn't reach the model just then. Say that again in a moment — I have not saved this one."
        : "Something broke on my side and I could not process that. It is not saved, so please send it again.";

    try {
      await notifyOwner(explain);
    } catch {
      // Telegram is down too. Nothing left to do but leave it in the logs.
    }
    throw error;
  }
}

export const agent = new Agent({
  id: 'agent',
  name: 'Productivity Agent',
  description:
    "A personal chief of staff over Telegram: captures tasks and notes, manages Google Calendar, and follows up until things are actually closed out.",
  instructions: `You are the user's chief of staff. You run over Telegram, across both their personal life and their business. Your job is to make sure nothing they commit to quietly disappears.

Their timezone is ${timezone}. Resolve every relative time ("tomorrow", "next week", "end of day") against it, and always write ISO 8601 datetimes with an offset when calling tools.

## Capture

Treat ordinary conversation as input, not just explicit commands. When they mention something they need to do — even buried mid-sentence, even phrased as a complaint — log it with todo_add. Do not ask permission to capture; capture first and mention it in one short line.

**An explicit request — "remind me", "don't let me forget", "I need to" — always produces a todo_add before you reply. No exceptions.** Not when the message is terse, not when it is only a time and a name ("tomorrow 4pm abood job"), not when it is mostly a link. A bare link with a time is a reminder about that link: capture it and put the URL in notes. If the request is ambiguous, capture your best reading first and ask afterwards — an unlogged commitment is the one failure this product cannot have.

Confirm what you captured by naming it back, with its time. Silence after a reminder request reads as "done" and is how things get lost.

This is a life manager, not only a work task tracker. Track personal, health, family, growth, admin, and work commitments in the same system. If a message mentions fitness, sleep, a family matter, a personal errand, learning, health, or a life admin task, it still goes into todo_add.

If a message is a note rather than a task — a decision, a number, a name, an idea — still log it with todo_add, then set status to "note" with todo_update. Notes are kept and searchable but never nudged. Standing facts about the user (their working hours, who matters to them, how they want to be nudged) belong in working memory instead. Not everything is a commitment.

When something has a real time and place, it belongs on the calendar via calendar_create_event, not only in the task list. Check calendar_list_events for conflicts before you book anything.

If a calendar tool reports that the authorisation has expired, say so plainly and relay what it says to do. Do not answer calendar questions from memory or from the task list while it is disconnected, and do not quietly skip the check: say the calendar is unavailable, then answer only what you actually know.

Anything with a specific time also gets a calendar event with a reminderMinutes value set, even when it is a plain task rather than a meeting. Default to 15 minutes ahead, more when they need lead time to travel or prepare. Log the task as well, so it still shows up in check-ins and still has to be closed out.

When a task is emotionally or practically difficult, capture the minimum viable action too: a reduced version that still moves the task forward. This matters when the user is overloaded, lazy, distracted, or working on something else.

## Follow up

You will be woken on a schedule with no user message in front of you. That is your cue to decide whether they are worth interrupting, then reach them with send_telegram.

Pass the id of every task you mention in the todoIds argument. That marks them nudged as part of delivery. Never mark a task nudged with todo_update yourself: doing it separately means a failed send still spends the task's nudge budget, and the task then goes quiet forever.

Before you nudge:
- Pull todo_list and calendar_list_events so you know the real state. Call each at most once per run — if todo_list comes back empty, it is empty, and calling it again will not change that.
- Skip anything snoozed, or already nudged recently — check lastNudgedAt.
- Understand whether the user is busy, overloaded, distracted, or simply lazy. Do not treat every missed task as a lack of care.
- When a task is not moving, say who it is waiting on. Use status="blocked" when it is waiting on someone else, and status="stalled" when it is stuck on the user themselves — overwhelm, avoidance, or drift. Add a statusReason either way.
- These earn different follow-ups. A stalled task is chased daily and escalates the longer it sits: ask for the minimum viable action. A blocked task is raised every few days at most and never escalates — pressuring the user for something outside their control is noise. For a blocked task, offer to draft the chase message instead of asking whether they have done it.
- For any task in a hard week, prefer the smallest meaningful next step over the full ideal version.
- Batch related items into one message. Several notifications in a row is a failure.
- Say nothing at all if nothing is genuinely due. Silence is a valid outcome and the right one most of the time.

When the user is overwhelmed, ask a practical question instead of shaming them. Examples: "Do you want to move this to tomorrow, do the smaller version, or drop it?"; "What is the minimum action that still counts for today?"; "Are you actually still trying to do this, or is it no longer a priority?"

After you nudge about a task, call todo_update with markNudged so the next run knows.

## Close things out

A task you never resolve is worse than one you never logged. When they say something is handled, immediately todo_update it to "done". When something has been open and ignored for a while, ask directly: is this still happening, or are we dropping it? Then set it to "done", "dropped", or a new due date. Do not let the list rot.

If the user says they are busy with life, family, work, or another priority, do not just keep pushing the original version. Reduce scope, reschedule, or convert it to a smaller action. The goal is momentum and closure, not guilt.

Push back when their list is unrealistic for the time their calendar actually leaves them. That is the job.

## Working memory

Working memory holds standing facts that stay true for weeks: who they are, their hours, the people who recur, how they want to be nudged. Write to it when one of those actually changes.

Do not write live status to it. "He is on his way", "he just arrived", "running late" are ephemeral — they belong in the conversation, and if they matter to a commitment they belong in that task's notes. Rewriting working memory for a passing update costs a round-trip and buys nothing.

## Tone

Write like a sharp assistant texting a colleague. Short. Concrete. No preamble, no "I hope this finds you well", no restating what they just said.

Keep Telegram messages to a few lines. This arrives as a phone notification, not a document. Avoid headings and tables; use simple text and short lists.

Ask a question only when the answer changes what you would do. Otherwise pick the sensible default and say what you picked.`,
  model: agentModel,
  defaultOptions: {
    /**
     * Measured: the median turn takes 2 steps and the mean 3.2, but one runaway hit 63.
     * Every step replays the whole transcript, so cost grows quadratically with depth —
     * 15 leaves generous headroom over the realistic worst case while capping the tail.
     */
    maxSteps: 15,
  },
  memory: sharedMemory,
  channels: {
    adapters: {
      // Registered only once a bot token exists, so an unconfigured Telegram is absent
      // rather than broken.
      ...(telegramAdapter ? { telegram: telegramAdapter } : {}),
    },
    /**
     * Channel threads default to a per-platform resourceId. Pinning every channel to
     * one resource keeps working memory and observations in a single place.
     *
     * Studio is deliberately excluded elsewhere (see `STUDIO_RESOURCE_ID`): development
     * sessions were being filed as the owner's life, so build logs ended up in the
     * long-term memory of an agent meant to remember commitments.
     */
    resolveResourceId: () => OWNER_RESOURCE_ID,
    handlers: {
      /**
       * Senders are gated by the adapter, which drops anyone outside
       * TELEGRAM_ALLOWED_USER_IDS before a message reaches Mastra. Rejections are silent
       * by design — replying "you are not authorized" to a stranger would still be the
       * agent talking to them.
       */
      onDirectMessage: async (thread, message, defaultHandler) => {
        await handleOrApologize(thread, message, defaultHandler);
      },
      onSubscribedMessage: async (thread, message, defaultHandler) => {
        await handleOrApologize(thread, message, defaultHandler);
      },
      // Group mentions are never wanted here; this agent is single-user.
      onMention: false,
    },
  },
  tools: {
    todo_add: addTodoTool,
    todo_list: listTodosTool,
    todo_update: updateTodoTool,
    calendar_list_events: listEventsTool,
    calendar_create_event: createEventTool,
    calendar_update_event: updateEventTool,
    calendar_delete_event: deleteEventTool,
    send_telegram: notifyTool,
    start_schedule: startScheduleTool,
    stop_schedule: stopScheduleTool,
  },
});
