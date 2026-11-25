// Speech-to-text client for the G2 microphone (Day 3).
//
// The G2 mic emits PCM s16le @ 16 kHz, mono via `bridge.audioControl(true)`.
// Each onEvenHubEvent callback with `audioEvent.audioPcm` delivers a chunk.
//
// Buffer-and-POST client (no streaming STT in v1): `sendPcm` appends chunks
// to an in-memory buffer (capped at ~15 s ≈ 480 KB); `close()` POSTs the
// buffer to `<backend>/stt` and emits the transcript as one final snapshot
// (`finalText`, `finished:true`). Errors go to `onError`.
//
// The Groq API key lives ONLY in the backend — this client never sees a key.
// The first constructor arg is the backend URL, not an API key.

export interface SttSnapshot {
  finalText: string
  interimText: string
  finished: boolean
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  close(): void
}

/** 15 s of 16 kHz s16le mono PCM = 15 * 16000 * 2 bytes. */
export const STT_MAX_BUFFER_BYTES = 480_000

interface SttResponse {
  ok?: boolean
  transcript?: string
  error?: string
}

export function startSttStream(
  backendUrl: string,
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let closed = false

  return {
    sendPcm(chunk: Uint8Array): void {
      if (closed) return
      if (totalBytes >= STT_MAX_BUFFER_BYTES) return // cap: drop the tail past 15 s
      const room = STT_MAX_BUFFER_BYTES - totalBytes
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk
      chunks.push(kept)
      totalBytes += kept.length
    },

    close(): void {
      if (closed) return
      closed = true
      void (async () => {
        try {
          const pcm = new Uint8Array(totalBytes)
          let offset = 0
          for (const chunk of chunks) {
            pcm.set(chunk, offset)
            offset += chunk.length
          }
          const res = await fetch(`${backendUrl}/stt`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: pcm,
            signal: AbortSignal.timeout(30_000),
          })
          const data = (await res.json().catch(() => ({}))) as SttResponse
          if (!res.ok || !data.ok) {
            throw new Error(
              typeof data.error === 'string' ? data.error : `STT failed (HTTP ${res.status})`,
            )
          }
          onSnapshot({ finalText: data.transcript ?? '', interimText: '', finished: true })
        } catch (err) {
          onError?.(err)
        }
      })()
    },
  }
}
