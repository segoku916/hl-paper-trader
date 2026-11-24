#!/usr/bin/env python3
"""Groq Whisper connectivity check (Day 3 test-plan step 1).

Posts a 1 s 16 kHz s16le WAV (a plain sine tone — the transcript will be
empty/garbage, that is fine) to Groq whisper-large-v3-turbo and prints the
HTTP status + transcript. This proves the key works and the model answers;
real phrase transcription is tested end-to-end after deploy, via /stt.

Usage: GROQ_API_KEY=... python3 groq-whisper-check.py [--wav voice.wav]
The key is read from the environment only — never paste it in here.
"""
import math
import os
import struct
import sys
import urllib.request
import uuid
import wave

MODEL = "whisper-large-v3-turbo"
URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def tone_wav(path: str, seconds: float = 1.0) -> None:
    rate = 16000
    frames = b"".join(
        struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / rate)))
        for i in range(int(rate * seconds))
    )
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)


def main() -> int:
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        print("GROQ_API_KEY is not set in the environment — nothing sent.")
        return 2
    wav_path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--wav" else "/tmp/groq-check-tone.wav"
    if not os.path.exists(wav_path):
        tone_wav(wav_path)
        print(f"generated tone WAV: {wav_path}")
    boundary = uuid.uuid4().hex
    with open(wav_path, "rb") as f:
        audio = f.read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.wav\"\r\n"
        f"Content-Type: audio/wav\r\n\r\n".encode()
        + audio
        + f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{MODEL}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nen\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n"
        f"--{boundary}--\r\n".encode()
    )
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"HTTP {resp.status}")
            print(resp.read().decode("utf-8", "replace"))
        return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}")
        print(e.read().decode("utf-8", "replace"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
