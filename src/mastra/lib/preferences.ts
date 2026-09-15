/**
 * How hard the agent chases a person, and how it sounds while doing it.
 *
 * Preferences are structured values with enforced bounds, never free text the model
 * interprets. Two reasons, and both are about protecting the user from their own
 * configuration:
 *
 * - "Chase me constantly" taken literally produces an agent that messages hourly, gets
 *   muted, and loses the user entirely. The clamp is what keeps "firm" persistent rather
 *   than frantic.
 * - Personality that a user authors is prompt injection into their own agent. They pick
 *   dimensions; the instructions those map to are written here, where they can be
 *   reviewed.
 *
 * Import-free so the bounds can be exercised directly — they are the part that has to
 * hold when someone asks for something unreasonable.
 */

export type NudgeIntensity = 'gentle' | 'standard' | 'firm';

/** 1 (low) to 5 (high) on each axis. Range, without letting anyone write the prompt. */
export interface Tone {
  warmth: number;
  directness: number;
  humour: number;
}

export interface Preferences {
  intensity: NudgeIntensity;
  tone: Tone;
  /** Shown in conversation. Cosmetic, and sanitised. */
  personaName: string | null;
  /** "HH:MM" in the user's own timezone, or null to switch that check-in off. */
  morningBriefAt: string | null;
  middaySweepAt: string | null;
  eveningCloseoutAt: string | null;
  /** No unprompted message lands between these, whatever else is configured. */
  quietStart: string;
  quietEnd: string;
  maxNudgesPerDay: number;
}

/**
 * Ceilings that hold regardless of what anyone asks for.
 *
 * A muted bot is a lost user, so these protect the product as much as the person. They are
 * also a cost ceiling: nudges are agent runs, and an unbounded nudge count is an unbounded
 * bill for an account that may be paying a flat fee.
 */
export const HARD_LIMITS = {
  maxNudgesPerDay: 6,
  minNudgesPerDay: 1,
  /** Never two unprompted messages closer together than this. */
  minGapHours: 4,
  personaNameMaxLength: 24,
} as const;

/** What each intensity means in hours between chases. */
export const INTENSITY_COOLDOWNS: Record<NudgeIntensity, { stalled: number; blocked: number }> = {
  gentle: { stalled: 48, blocked: 120 },
  standard: { stalled: 24, blocked: 72 },
  firm: { stalled: 12, blocked: 48 },
};

export const DEFAULT_PREFERENCES: Preferences = {
  intensity: 'standard',
  tone: { warmth: 3, directness: 4, humour: 2 },
  personaName: null,
  morningBriefAt: '08:00',
  middaySweepAt: '14:00',
  eveningCloseoutAt: '21:00',
  quietStart: '22:00',
  quietEnd: '07:00',
  maxNudgesPerDay: 4,
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanTime(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' && TIME.test(value) ? value : fallback;
}

/**
 * Strip a persona name back to something safe to render.
 *
 * It ends up inside the agent's instructions, so it is treated as untrusted input:
 * newlines and markup would let a name carry instructions of its own.
 */
function cleanName(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replace(/[\r\n`<>{}[\]|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HARD_LIMITS.personaNameMaxLength);
  return cleaned.length > 0 ? cleaned : null;
}

export interface ClampResult {
  preferences: Preferences;
  /** What was adjusted, so the user can be told rather than silently overruled. */
  adjustments: string[];
}

/**
 * Force any requested settings into the supported range.
 *
 * Always returns something usable: partial input, nonsense, and hostile input all resolve
 * to valid preferences rather than throwing, because this sits between a conversation and
 * the scheduler and must never be the reason a turn fails.
 */
export function clampPreferences(
  input: Partial<Preferences> | null | undefined,
  base: Preferences = DEFAULT_PREFERENCES,
): ClampResult {
  const adjustments: string[] = [];
  const requested = input ?? {};

  const intensity: NudgeIntensity =
    requested.intensity && requested.intensity in INTENSITY_COOLDOWNS
      ? requested.intensity
      : base.intensity;

  const requestedMax = requested.maxNudgesPerDay;
  const maxNudgesPerDay = clampInt(
    requestedMax,
    HARD_LIMITS.minNudgesPerDay,
    HARD_LIMITS.maxNudgesPerDay,
    base.maxNudgesPerDay,
  );
  if (typeof requestedMax === 'number' && requestedMax > HARD_LIMITS.maxNudgesPerDay) {
    adjustments.push(
      `Capped at ${HARD_LIMITS.maxNudgesPerDay} nudges a day — past that it stops being useful and starts being noise.`,
    );
  }

  const tone: Tone = {
    warmth: clampInt(requested.tone?.warmth, 1, 5, base.tone.warmth),
    directness: clampInt(requested.tone?.directness, 1, 5, base.tone.directness),
    humour: clampInt(requested.tone?.humour, 1, 5, base.tone.humour),
  };

  const personaName = cleanName(
    requested.personaName === undefined ? base.personaName : requested.personaName,
    base.personaName,
  );

  return {
    preferences: {
      intensity,
      tone,
      personaName,
      morningBriefAt: cleanTime(requested.morningBriefAt, base.morningBriefAt),
      middaySweepAt: cleanTime(requested.middaySweepAt, base.middaySweepAt),
      eveningCloseoutAt: cleanTime(requested.eveningCloseoutAt, base.eveningCloseoutAt),
      quietStart: cleanTime(requested.quietStart, base.quietStart) ?? base.quietStart,
      quietEnd: cleanTime(requested.quietEnd, base.quietEnd) ?? base.quietEnd,
      maxNudgesPerDay,
    },
    adjustments,
  };
}

/** Cooldown hours for a user's chosen intensity. */
export function cooldownsFor(preferences: Preferences): { stalled: number; blocked: number } {
  return INTENSITY_COOLDOWNS[preferences.intensity];
}

/**
 * Whether an unprompted message may be sent at this moment.
 *
 * The last line before delivery. Quiet hours and the daily ceiling are enforced here
 * rather than asked of the model, because an instruction is a request and this is a rule.
 */
export function mayNudgeNow(
  preferences: Preferences,
  context: { localTime: string; nudgesSoFarToday: number; hoursSinceLastNudge: number | null },
): { allowed: boolean; reason?: string } {
  if (!TIME.test(context.localTime)) return { allowed: true };

  if (isWithinQuietHours(context.localTime, preferences.quietStart, preferences.quietEnd)) {
    return { allowed: false, reason: 'quiet-hours' };
  }
  if (context.nudgesSoFarToday >= preferences.maxNudgesPerDay) {
    return { allowed: false, reason: 'daily-limit' };
  }
  if (context.hoursSinceLastNudge !== null && context.hoursSinceLastNudge < HARD_LIMITS.minGapHours) {
    return { allowed: false, reason: 'too-soon' };
  }
  return { allowed: true };
}

/** Handles windows that cross midnight, which quiet hours almost always do. */
export function isWithinQuietHours(now: string, start: string, end: string): boolean {
  const minutes = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const n = minutes(now);
  const s = minutes(start);
  const e = minutes(end);
  return s <= e ? n >= s && n < e : n >= s || n < e;
}
