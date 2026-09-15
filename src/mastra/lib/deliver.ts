/**
 * Delivering a message to a person, without knowing how they are reached.
 *
 * The product is meant to work over Telegram now, WhatsApp later, and its own app if
 * neither is enough. Every one of those is a way of addressing someone, not a different
 * product, so the agent should say "tell this user" and nothing above this layer should
 * name a platform.
 *
 * Import-free on purpose: the routing rule is the part worth being sure about, and it can
 * be exercised here without a database or a network.
 */

export type ChannelKind = 'telegram' | 'whatsapp' | 'push';

/** Sends one message to one address on one platform. */
export type Sender = (externalId: string, markdown: string) => Promise<unknown>;

export interface DeliveryDeps {
  /** Where this user should be reached, or null if nowhere. */
  resolve: (userId: string) => Promise<{ channel: ChannelKind; externalId: string } | null>;
  /** A sender per platform. A missing entry means that platform is not configured. */
  senders: Partial<Record<ChannelKind, Sender>>;
}

export interface Delivery {
  channel: ChannelKind;
  externalId: string;
}

export class UndeliverableError extends Error {
  readonly reason: 'no-channel' | 'channel-unsupported';

  constructor(message: string, reason: 'no-channel' | 'channel-unsupported') {
    super(message);
    this.name = 'UndeliverableError';
    this.reason = reason;
  }
}

/**
 * Send to whichever channel this user is reachable on.
 *
 * Failures are loud and specific rather than swallowed. A nudge that silently goes nowhere
 * is the failure this product exists to prevent, and the caller marks a commitment as
 * chased only once this resolves — so throwing is what keeps the commitment alive for the
 * next attempt.
 */
export async function deliver(
  userId: string,
  markdown: string,
  deps: DeliveryDeps,
): Promise<Delivery> {
  const target = await deps.resolve(userId);
  if (!target) {
    throw new UndeliverableError(`No channel is linked for user ${userId}`, 'no-channel');
  }

  const send = deps.senders[target.channel];
  if (!send) {
    throw new UndeliverableError(
      `User ${userId} is reachable on ${target.channel}, which is not configured in this deployment`,
      'channel-unsupported',
    );
  }

  await send(target.externalId, markdown);
  return target;
}
