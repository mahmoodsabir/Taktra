import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { notifyOwner } from '../lib/notify';
import { updateTodo } from '../lib/todos';

export const notifyTool = createTool({
  id: 'send_telegram',
  description:
    'Push a Telegram message to the user out of the blue. Use this only during scheduled check-ins and reminders — when the user is already talking to you, just reply normally instead. Always pass the ids of every task you are nudging about, so they are recorded as nudged.',
  inputSchema: z.object({
    message: z
      .string()
      .describe('What to say. Keep it to a few lines; this lands as a phone notification.'),
    todoIds: z
      .array(z.number().int())
      .default([])
      .describe(
        'Ids of every task this message nudges about. They are marked nudged only once the message is actually delivered, so never mark them yourself with todo_update.',
      ),
  }),
  execute: async ({ message, todoIds }) => {
    /**
     * Delivery first, bookkeeping second — and never the other way round.
     *
     * These used to be two independent tool calls, so a failed send followed by a
     * successful `todo_update(markNudged)` spent the task's nudge budget without a
     * message ever arriving. The sweep then went quiet forever and the commitment was
     * silently lost, which is the exact failure this product exists to prevent.
     * Throwing here leaves the tasks unmarked, so the next sweep retries them.
     */
    const result = await notifyOwner(message);

    const nudged: number[] = [];
    for (const id of todoIds) {
      try {
        await updateTodo(id, { markNudged: true });
        nudged.push(id);
      } catch {
        // The message is already out. A failed mark means a duplicate nudge later,
        // which is far better than a commitment that goes quiet.
      }
    }

    return { ...result, nudged };
  },
});
