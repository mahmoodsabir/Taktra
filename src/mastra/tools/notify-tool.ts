import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { notifyOwner } from '../lib/notify';

export const notifyTool = createTool({
  id: 'send_telegram',
  description:
    'Push a Telegram message to the user out of the blue. Use this only during scheduled check-ins and reminders — when the user is already talking to you, just reply normally instead.',
  inputSchema: z.object({
    message: z
      .string()
      .describe('What to say. Keep it to a few lines; this lands as a phone notification.'),
  }),
  execute: async ({ message }) => notifyOwner(message),
});
