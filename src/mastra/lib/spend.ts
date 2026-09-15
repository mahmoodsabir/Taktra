/**
 * What each account costs to serve.
 *
 * The product absorbs model cost and charges for it, so spend per user is a margin line
 * rather than a bill to glance at. A price set without this is a guess, and a heavy user
 * who costs more than they pay is invisible until the invoice arrives.
 *
 * Deliberately records the token counts rather than only a total, because prices change
 * and a stored dollar figure cannot be recomputed. Same principle as the event log: keep
 * the inputs, derive the number.
 */

/** Per million tokens, matching OpenAI's published rates. */
export interface ModelRate {
  input: number;
  cachedInput: number;
  output: number;
}

export const MODEL_RATES: Record<string, ModelRate> = {
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
};

/** Per minute of audio, for transcription. */
export const TRANSCRIPTION_RATES: Record<string, number> = {
  'gpt-4o-mini-transcribe': 0.003,
  'gpt-4o-transcribe': 0.006,
  'whisper-1': 0.006,
  whisper: 0.006,
  /** Self-hosted: no marginal cost, though the host is not free. */
  'whisper-local': 0,
};

export interface Usage {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}

/**
 * What one model call cost, in dollars.
 *
 * Cached input is billed separately and is most of the input on a warm prompt — ignoring
 * it overstates spend several times over, which would price the product wrong in the
 * expensive direction.
 */
export function costOf(model: string, usage: Usage): number {
  const rate = MODEL_RATES[normaliseModel(model)];
  if (!rate) return 0;

  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = usage.inputTokens - cached;

  return (
    (uncached / 1e6) * rate.input +
    (cached / 1e6) * rate.cachedInput +
    (usage.outputTokens / 1e6) * rate.output
  );
}

/** Cost of transcribing a voice note. */
export function transcriptionCostOf(model: string, seconds: number): number {
  const perMinute = TRANSCRIPTION_RATES[model];
  if (perMinute === undefined) return 0;
  return (Math.max(0, seconds) / 60) * perMinute;
}

/** Strips the provider prefix Mastra routes with, so 'openai/gpt-5.6-luna' matches. */
export function normaliseModel(model: string): string {
  return model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
}

/** An unknown model earns a zero rather than a crash — but it is worth noticing. */
export function isModelPriced(model: string): boolean {
  return normaliseModel(model) in MODEL_RATES;
}
