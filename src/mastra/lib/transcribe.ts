/**
 * Turning a voice note into text the agent can act on.
 *
 * Speaking is the lowest-friction way to capture a commitment — the moment someone
 * remembers something is rarely a moment they can type. That makes this a capture feature
 * rather than a convenience, and it inherits the same rule: a voice note that fails to
 * transcribe must be visible, never silently dropped.
 *
 * The provider is a configuration choice. Self-hosted Whisper has no per-minute cost but
 * wants memory the host may not have; the hosted models cost about a tenth of a cent a
 * minute and nothing to run. Whichever is in use, nothing above this module knows.
 */

export type TranscriptionProvider = 'openai' | 'local';

export interface TranscriptionRequest {
  audio: ArrayBuffer | Buffer;
  /** Used for the upload filename, which is how the API infers the codec. */
  filename?: string;
  mimeType?: string;
}

export interface TranscriptionResult {
  text: string;
  /** For per-account cost accounting; absent when the provider does not report it. */
  seconds?: number;
  model: string;
}

export class TranscriptionError extends Error {
  readonly provider: TranscriptionProvider;

  constructor(message: string, provider: TranscriptionProvider) {
    super(message);
    this.name = 'TranscriptionError';
    this.provider = provider;
  }
}

/** Which provider this deployment uses. Self-hosted by default; hosted is the fallback. */
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): TranscriptionProvider {
  const choice = env.TRANSCRIBE_PROVIDER?.trim().toLowerCase();
  if (choice === 'openai' || choice === 'local') return choice;
  // A local endpoint is only assumed when one has actually been configured, so a fresh
  // deployment works without standing up a speech server first.
  return env.WHISPER_URL ? 'local' : 'openai';
}

export function modelFor(provider: TranscriptionProvider, env: NodeJS.ProcessEnv = process.env): string {
  return provider === 'local'
    ? env.WHISPER_MODEL || 'whisper-local'
    : env.TRANSCRIBE_MODEL || 'whisper-1';
}

/** A filename the provider can infer a codec from. Telegram voice notes are Opus in Ogg. */
export function filenameFor(mimeType?: string, fallback = 'voice.ogg'): string {
  if (!mimeType) return fallback;
  const ext = mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('mpeg') || mimeType.includes('mp3')
      ? 'mp3'
      : mimeType.includes('wav')
        ? 'wav'
        : mimeType.includes('m4a') || mimeType.includes('mp4')
          ? 'm4a'
          : mimeType.includes('webm')
            ? 'webm'
            : null;
  return ext ? `voice.${ext}` : fallback;
}

/**
 * Whether an attachment is worth sending to a speech model.
 *
 * Telegram labels a held-to-record note `voice_note` and an attached file `audio`; both
 * are speech worth reading. Anything else is left alone.
 */
export function isAudio(
  attachment: { type?: string; mimeType?: string; name?: string } | null | undefined,
): boolean {
  if (!attachment) return false;
  // Adapters vary in what they populate: a type, a mime type, or only a filename.
  if (attachment.type === 'audio' || attachment.type === 'voice_note') return true;
  const mime = attachment.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('audio/')) return true;
  return /\.(ogg|oga|opus|mp3|m4a|wav|webm)$/i.test(attachment.name ?? '');
}

/**
 * Get the bytes out of an attachment, however this adapter chose to provide them.
 *
 * Some deliver the data inline, some a `fetchData` that handles auth, and some only a
 * URL. Requiring any one of those is how the first version of this silently failed on
 * every voice note.
 */
export async function attachmentBytes(attachment: {
  data?: unknown;
  fetchData?: () => Promise<ArrayBuffer | Buffer>;
  url?: string;
}): Promise<ArrayBuffer | Buffer> {
  if (attachment.data) return attachment.data as ArrayBuffer | Buffer;

  if (typeof attachment.fetchData === 'function') {
    const fetched = await attachment.fetchData();
    if (fetched) return fetched;
  }

  if (attachment.url) {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Could not download the attachment: ${response.status}`);
    }
    return await response.arrayBuffer();
  }

  throw new Error('Attachment carried no data, no fetchData and no url');
}

/**
 * The richest response format this model actually accepts.
 *
 * Whisper reports the clip's duration under `verbose_json`, which is what per-account cost
 * accounting is priced on. The newer transcribe models reject that format outright — a 400
 * that failed every voice note — so they get plain `json` and their duration is simply
 * unknown rather than fatal.
 */
export function responseFormatFor(model: string): 'verbose_json' | 'json' {
  return /whisper/i.test(model) ? 'verbose_json' : 'json';
}

async function toBlob(audio: ArrayBuffer | Buffer, mimeType: string): Promise<Blob> {
  const view = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio);
  return new Blob([view], { type: mimeType });
}

/**
 * Transcribe a voice note.
 *
 * Both providers speak the same multipart API — a self-hosted whisper.cpp or
 * faster-whisper server exposes an OpenAI-compatible route — so the only difference is
 * where the request goes and whether it carries a key.
 */
export async function transcribe(
  request: TranscriptionRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TranscriptionResult> {
  const provider = configuredProvider(env);
  const model = modelFor(provider, env);
  const mimeType = request.mimeType || 'audio/ogg';

  const endpoint =
    provider === 'local'
      ? `${(env.WHISPER_URL || '').replace(/\/$/, '')}/v1/audio/transcriptions`
      : 'https://api.openai.com/v1/audio/transcriptions';

  if (provider === 'local' && !env.WHISPER_URL) {
    throw new TranscriptionError('WHISPER_URL is not set', provider);
  }
  if (provider === 'openai' && !env.OPENAI_API_KEY) {
    throw new TranscriptionError('OPENAI_API_KEY is not set', provider);
  }

  const requestedModel = provider === 'local' ? env.WHISPER_MODEL || 'whisper-1' : model;

  const form = new FormData();
  form.append('file', await toBlob(request.audio, mimeType), request.filename ?? filenameFor(mimeType));
  form.append('model', requestedModel);
  form.append('response_format', responseFormatFor(requestedModel));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: provider === 'openai' ? { Authorization: `Bearer ${env.OPENAI_API_KEY}` } : undefined,
    body: form,
  });

  if (!response.ok) {
    throw new TranscriptionError(
      `Transcription failed: ${response.status} ${await response.text().catch(() => '')}`.trim(),
      provider,
    );
  }

  const body = (await response.json()) as { text?: unknown; duration?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new TranscriptionError('Transcription returned no text', provider);

  return {
    text,
    seconds: typeof body.duration === 'number' ? body.duration : undefined,
    model,
  };
}
