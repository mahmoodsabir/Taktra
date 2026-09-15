import { telegramAdapter, telegramOwnerChatId } from './telegram';
import { deliver, type DeliveryDeps } from './deliver.ts';
import { OWNER_USER_ID, primaryChannel } from './users.ts';

export interface NotifyResult {
  delivered: 'telegram' | 'whatsapp' | 'push';
}

/** Send one Telegram message to one chat. The only channel wired up so far. */
const sendTelegram = async (chatId: string, markdown: string) => {
  if (!telegramAdapter) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return telegramAdapter.postMessage(telegramAdapter.encodeThreadId({ chatId }), { markdown });
};

/**
 * Adding WhatsApp or push means adding a sender here and a row in `user_channels`.
 * Nothing above this line names a platform.
 */
const deps: DeliveryDeps = {
  resolve: async (userId) => {
    const channel = await primaryChannel(userId);
    if (channel) return { channel: channel.channel, externalId: channel.externalId };

    // A deployment that predates accounts still has its chat id in the environment.
    const fallback = telegramOwnerChatId();
    return fallback ? { channel: 'telegram' as const, externalId: fallback } : null;
  },
  senders: { telegram: sendTelegram },
};

/** Push an unprompted message to a user. */
export async function notifyUser(userId: string, markdown: string): Promise<NotifyResult> {
  const { channel } = await deliver(userId, markdown, deps);
  return { delivered: channel };
}

/** The single owner of a pre-multi-user installation. */
export async function notifyOwner(markdown: string): Promise<NotifyResult> {
  return notifyUser(OWNER_USER_ID, markdown);
}
