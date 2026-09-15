/**
 * Detecting commitments the agent may have failed to capture.
 *
 * An uncaptured commitment is this product's worst failure: the owner believes it is
 * tracked, the agent has no record, and nobody finds out. It has already happened — two
 * explicit reminder requests produced no task and left no trace anywhere.
 *
 * The instructions tell the agent to always capture. This is the check that the
 * instruction held, because a prompt-level guarantee fails silently by definition.
 *
 * It only ever records. Blocking or second-guessing the model mid-turn would trade a rare
 * silent miss for frequent visible wrongness, and the heuristic is far too blunt to be
 * trusted with that.
 */

/** Phrasings that are a request to remember something, not conversation. */
const EXPLICIT_REQUEST =
  /\b(remind me|don'?t (?:let me )?forget|do not forget|remember to|make sure i|i need to|i have to|i must|note that|add (?:a )?(?:task|todo|reminder))\b/i;

/** A bare time or date, which in this product nearly always attaches to a commitment. */
const TIME_REFERENCE =
  /\b(tomorrow|tonight|today|next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|every (?:day|week|month|morning|friday|weekend)|\d{1,2}\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;

/**
 * Whether a message plausibly asked for something to be remembered.
 *
 * Tuned to over-report: a false positive costs one log line, a false negative is the
 * failure this exists to find. Callers must not make it user-visible.
 */
export function looksLikeCommitment(text: string): boolean {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length === 0) return false;

  // A bot command is never a commitment.
  if (/^\//.test(trimmed)) return false;

  if (EXPLICIT_REQUEST.test(trimmed)) return true;

  // "tomorrow 4pm abood job" — no verb, no request phrasing, still a commitment. A time
  // plus enough words to name something is the signal; a bare "tomorrow?" is not.
  return TIME_REFERENCE.test(trimmed) && trimmed.split(/\s+/).length >= 3;
}
