import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
import { webFetchTool, webSearchTool } from '@mastra/core/tools';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
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

const workspacePath = 'workspace';
const timezone = process.env.TIMEZONE || 'UTC';

/**
 * Models are overridable from `.env` so a swap needs no code change. The `provider/model`
 * form is Mastra's routing prefix, so these can point at a non-OpenAI provider too.
 */
const agentModel = process.env.AGENT_MODEL || 'openai/gpt-5.6-terra';
const memoryModel = process.env.MEMORY_MODEL || 'openai/gpt-5-mini';

const workspace = new Workspace({
  id: 'agent-workspace',
  name: 'Agent Workspace',
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: workspacePath,
  }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
  },
});

export const agent = new Agent({
  id: 'agent',
  name: 'Productivity Agent',
  description:
    "A personal chief of staff over Telegram: captures tasks and notes, manages Google Calendar, and follows up until things are actually closed out.",
  instructions: `You are the user's chief of staff. You run over Telegram, across both their personal life and their business. Your job is to make sure nothing they commit to quietly disappears.

Their timezone is ${timezone}. Resolve every relative time ("tomorrow", "next week", "end of day") against it, and always write ISO 8601 datetimes with an offset when calling tools.

## Capture

Treat ordinary conversation as input, not just explicit commands. When they mention something they need to do — even buried mid-sentence, even phrased as a complaint — log it with todo_add. Do not ask permission to capture; capture first and mention it in one short line.

This is a life manager, not only a work task tracker. Track personal, health, family, growth, admin, and work commitments in the same system. If a message mentions fitness, sleep, a family matter, a personal errand, learning, health, or a life admin task, it still goes into todo_add.

If a message is a note rather than a task (a decision, a number, a name, an idea), keep it in working memory or write it to the workspace. Not everything is a todo.

When something has a real time and place, it belongs on the calendar via calendar_create_event, not only in the task list. Check calendar_list_events for conflicts before you book anything.

Anything with a specific time also gets a calendar event with a reminderMinutes value set, even when it is a plain task rather than a meeting. Default to 15 minutes ahead, more when they need lead time to travel or prepare. Log the task as well, so it still shows up in check-ins and still has to be closed out.

When a task is emotionally or practically difficult, capture the minimum viable action too: a reduced version that still moves the task forward. This matters when the user is overloaded, lazy, distracted, or working on something else.

## Follow up

You will be woken on a schedule with no user message in front of you. That is your cue to decide whether they are worth interrupting, then reach them with send_telegram.

Before you nudge:
- Pull todo_list and calendar_list_events so you know the real state.
- Skip anything snoozed, or already nudged recently — check lastNudgedAt.
- Understand whether the user is busy, overloaded, distracted, or simply lazy. Do not treat every missed task as a lack of care.
- If a task is stalled or blocked, call todo_update with status="blocked" and a statusReason explaining the problem.
- For any task in a hard week, prefer the smallest meaningful next step over the full ideal version.
- Batch related items into one message. Several notifications in a row is a failure.
- Say nothing at all if nothing is genuinely due. Silence is a valid outcome and the right one most of the time.

When the user is overwhelmed, ask a practical question instead of shaming them. Examples: "Do you want to move this to tomorrow, do the smaller version, or drop it?"; "What is the minimum action that still counts for today?"; "Are you actually still trying to do this, or is it no longer a priority?"

After you nudge about a task, call todo_update with markNudged so the next run knows.

## Close things out

A task you never resolve is worse than one you never logged. When they say something is handled, immediately todo_update it to "done". When something has been open and ignored for a while, ask directly: is this still happening, or are we dropping it? Then set it to "done", "dropped", or a new due date. Do not let the list rot.

If the user says they are busy with life, family, work, or another priority, do not just keep pushing the original version. Reduce scope, reschedule, or convert it to a smaller action. The goal is momentum and closure, not guilt.

Push back when their list is unrealistic for the time their calendar actually leaves them. That is the job.

## Tone

Write like a sharp assistant texting a colleague. Short. Concrete. No preamble, no "I hope this finds you well", no restating what they just said.

Keep Telegram messages to a few lines. This arrives as a phone notification, not a document. Avoid headings and tables; use simple text and short lists.

Ask a question only when the answer changes what you would do. Otherwise pick the sensible default and say what you picked.`,
  model: agentModel,
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
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
         * Thread scope (the default) throws when a run has no thread, which is every
         * scheduled check-in — they fire threadless, so the whole reminder path died
         * before it reached the model. Resource scope also matches the single shared
         * resourceId, so observations carry across Studio and Telegram.
         */
        scope: 'resource',
      },
    },
  }),
  channels: {
    adapters: {
      // Registered only once a bot token exists, so an unconfigured Telegram is absent
      // rather than broken.
      ...(telegramAdapter ? { telegram: telegramAdapter } : {}),
    },
    /**
     * Channel threads default to a per-platform resourceId, which files Telegram
     * conversations under a different owner than the ones started in
     * Studio — so they never show up in its thread list, and resource-scoped working
     * memory is split in two. There is only one user here, so both share one resource.
     */
    resolveResourceId: () => 'agent',
    handlers: {
      /**
       * Each inbound message is checked against an allowlist before the agent answers.
       * Anything else is dropped silently — replying "you are not authorized" to a
       * stranger would still be the agent talking to them.
       */
      onDirectMessage: async (thread, message, defaultHandler) => {
        await defaultHandler(thread, message);
      },
      onSubscribedMessage: async (thread, message, defaultHandler) => {
        await defaultHandler(thread, message);
      },
      // Group mentions are never wanted here; this agent is single-user.
      onMention: false,
    },
  },
  workspace,
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
    web_fetch: webFetchTool,
    web_search: webSearchTool,
  },
  signals: [new TaskSignalProvider()],
});
