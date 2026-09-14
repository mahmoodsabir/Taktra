import { telegramAdapter, telegramOwnerChatId } from './telegram';

export interface NotifyResult {
  delivered: 'telegram';
}

/** Push an unprompted Telegram message to the owner. */
export async function notifyOwner(markdown: string): Promise<NotifyResult> {
  const chatId = telegramOwnerChatId();

  if (!telegramAdapter) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_OWNER_CHAT_ID is not set');
  }

  await telegramAdapter.postMessage(telegramAdapter.encodeThreadId({ chatId }), {
    markdown,
  });
  return { delivered: 'telegram' };
}
