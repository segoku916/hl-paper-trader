/**
 * Speech-to-text — Day 3.
 *
 * The glasses mic ships 16 kHz, signed 16-bit LE, mono PCM. This module wraps
 * it in a 44-byte RIFF/WAV header and sends it to Groq Whisper
 * (whisper-large-v3-turbo). The Groq key lives only in the backend env
 * (Railway Variables in production) — it never reaches the glasses app.
 *
 * Limits (per DAY3-VOICE-PLAN.md): the app stops listening at ~15 s
 * (~480 KB); the server rejects audio longer than 30 s (~960 KB) with 400
 * and caps the raw body at ~2 MB.
 */

export const STT_SAMPLE_RATE = 16_000;
export const STT_MAX_SECONDS = 30;
export const STT_MAX_BYTES = STT_SAMPLE_RATE * 2 * STT_MAX_SECONDS; // 960_000
export const STT_BODY_CAP_BYTES = 2 * 1024 * 1024;
export const STT_MODEL = 'whisper-large-v3-turbo';

/** Wrap raw 16 kHz s16le mono PCM in a minimal WAV header. */
export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(STT_SAMPLE_RATE, 24);
  header.writeUInt32LE(STT_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class SttError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Transcribe PCM audio with Groq Whisper. Retries once on an upstream
 * failure, then throws SttError(502). Throws SttError(500) when the key is
 * missing — fail loud, never fall back to a key in the app.
 */
export async function transcribePcm(pcm: Buffer, apiKey: string | undefined): Promise<string> {
  if (!apiKey) {
    throw new SttError(500, 'GROQ_API_KEY is not configured on the backend');
  }
  if (pcm.length === 0) {
    throw new SttError(400, 'empty audio — nothing to transcribe');
  }
  if (pcm.length > STT_MAX_BYTES) {
    throw new SttError(400, 'audio too long — max 30 seconds per voice command');
  }

  const wav = pcmToWav(pcm);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Build the form inside the loop: a fetch consumes its body, so a retry
    // needs a fresh one.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'voice.wav');
    form.append('model', STT_MODEL);
    form.append('language', 'en');
    form.append('response_format', 'json');
    try {
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`Groq STT ${res.status}: ${detail}`);
      }
      const json = (await res.json()) as { text?: unknown };
      if (typeof json.text !== 'string') throw new Error('Groq STT returned no transcript');
      return json.text.trim();
    } catch (err) {
      lastErr = err;
      // Retry once on a transient upstream failure.
      if (attempt === 0) continue;
    }
  }
  throw new SttError(502, `voice transcription failed — ${(lastErr as Error)?.message ?? 'upstream error'}`);
}
