/**
 * The ordering rule for sending a nudge. Deliberately free of any transport or storage
 * import, so it can be exercised directly and so the rule cannot drift when either changes.
 */

export interface NudgeDeps {
  /** Deliver the message. Throwing means nothing reached the user. */
  send: (markdown: string) => Promise<unknown>;
  /** Record that a task has been nudged. */
  mark: (id: number) => Promise<unknown>;
}

export interface NudgeResult {
  delivered: true;
  nudged: number[];
}

/**
 * Send a nudge, then record it — in that order, always.
 *
 * A task's nudge budget may only be spent by a message that actually arrived. Sending and
 * recording used to be two independent tool calls, so a failed send followed by a
 * successful `todo_update(markNudged)` marked a task as chased with nothing delivered. The
 * sweep then skipped it forever and the commitment was silently lost — the one failure
 * this product exists to prevent.
 *
 * `send` throwing therefore marks nothing, and the next sweep retries. A `mark` that fails
 * after a successful send is swallowed: the worst case is being nudged twice, which is far
 * better than never being nudged again.
 */
export async function deliverNudge(
  message: string,
  todoIds: number[],
  deps: NudgeDeps,
): Promise<NudgeResult> {
  await deps.send(message);

  const nudged: number[] = [];
  for (const id of todoIds) {
    try {
      await deps.mark(id);
      nudged.push(id);
    } catch {
      // Already on the user's phone; a duplicate later beats a lost commitment.
    }
  }

  return { delivered: true, nudged };
}
