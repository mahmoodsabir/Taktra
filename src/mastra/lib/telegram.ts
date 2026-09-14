import { createTelegramAdapter } from '@chat-adapter/telegram';

/**
 * Telegram runs in polling mode rather than webhook mode.
 *
 * Polling only ever makes outbound requests, so it needs no public URL, no tunnel, and
 * nothing forwarded through the router — which matters here because the network this
 * runs on throttles Telegram and would make an inbound webhook the first thing to break.
 */
/** Whether a bot token is configured. */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/**
 * Keep the adapter undefined when Telegram is not configured so Studio can still start
 * and report a useful configuration error when a scheduled notification is attempted.
 */
export const telegramAdapter = telegramConfigured()
  ? createTelegramAdapter({
      mode: 'polling',
      userName: 'Productivity Agent',
      longPolling: {
        // Telegram refuses getUpdates while a webhook is registered.
        deleteWebhook: true,
      },
    })
  : undefined;

/**
 * Start the long-polling loop.
 *
 * Mastra's channel layer calls `initialize()` but never starts a transport, so without
 * this the adapter registers and then silently receives nothing.
 */
export async function connectTelegram(): Promise<void> {
  await telegramAdapter?.startPolling();
}

/**
 * The chat the agent pushes reminders to.
 *
 * For a private chat this is the owner's own numeric user ID, which is also what the
 * adapter's `allowedUserIds` gate accepts.
 */
export function telegramOwnerChatId(): string | undefined {
  return process.env.TELEGRAM_OWNER_CHAT_ID?.trim() || undefined;
}
