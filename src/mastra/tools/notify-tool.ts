import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { notifyOwner } from '../lib/notify';
import { deliverNudge } from '../lib/nudge';
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
  execute: async ({ message, todoIds }) =>
    deliverNudge(message, todoIds, {
      send: notifyOwner,
      mark: (id) => updateTodo(id, { markNudged: true }),
    }),
});
