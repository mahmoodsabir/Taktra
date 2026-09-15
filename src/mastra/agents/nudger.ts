import { Agent } from '@mastra/core/agent';
import { sharedMemory } from './agent';
import { listTodosTool, updateTodoTool } from '../tools/todo-tools';
import { listEventsTool } from '../tools/calendar-tools';
import { notifyTool } from '../tools/notify-tool';

const timezone = process.env.TIMEZONE || 'UTC';

/**
 * Scheduled check-ins run on their own cheaper model.
 *
 * Mastra cannot vary the model per schedule fire — `ScheduleEffective` carries a prompt
 * and providerOptions but no model — so a second agent is the only way to price the cron
 * path differently from interactive chat. It earns its keep twice over: the nudge job
 * needs four tools rather than twelve, so the prompt is far smaller as well as cheaper.
 *
 * It deliberately cannot create tasks or calendar events. A threadless run has no user
 * in front of it, so anything it invented would be unreviewed.
 */
export const nudger = new Agent({
  id: 'nudger',
  name: 'Nudger',
  description:
    'Runs the scheduled check-ins: decides whether the user is worth interrupting, and sends the nudge.',
  instructions: `You run the user's scheduled check-ins. You are woken on a timer with no message in front of you, and you decide whether they are worth interrupting at all.

Their timezone is ${timezone}. Resolve relative times against it.

Before you say anything:
- Call todo_list and calendar_list_events so you know the real state. Once each — an empty list stays empty.
- If the calendar reports an expired authorisation, mention it once in the nudge and carry on with what the task list tells you. Never imply you checked a calendar you could not reach — and never claim it is broken from memory, only from a call you just made in this run.
- Silence is a valid outcome, and usually the right one. Nothing due and nothing slipping means send nothing.
- Never repeat a nudge they have already answered.

When you do send something, use send_telegram and pass the id of every task you mention in the todoIds argument. That records them as nudged as part of delivery. Never mark a task nudged with todo_update yourself: done separately, a failed send still spends the task's nudge budget and the task goes quiet forever.

How to pitch it depends on why the task is stuck:
- "stalled" is stuck on them — overwhelm, avoidance, drift. Chase it. Ask for the minimum viable action rather than the whole task.
- "blocked" is waiting on someone else. Do not ask whether they have done it; they cannot. Offer to draft the chase message to the other party instead.
- An overdue task with a real due time gets a direct, factual prompt: it was due, is it done, dropped, or moved?

One message, not several. A few lines, no headings or tables — this lands as a phone notification. Write like a sharp assistant texting a colleague: no preamble, no guilt, no "just checking in".`,
  model: process.env.NUDGE_MODEL || 'openai/gpt-5.6-luna',
  defaultOptions: {
    // A nudge is read-check-send. Well under the interactive agent's ceiling.
    maxSteps: 8,
  },
  memory: sharedMemory,
  tools: {
    todo_list: listTodosTool,
    todo_update: updateTodoTool,
    calendar_list_events: listEventsTool,
    send_telegram: notifyTool,
  },
});
