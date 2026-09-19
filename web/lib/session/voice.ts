"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input over the browser's Web Speech API.
 *
 * The mobile app transcribes on-device; the browser cannot promise that, so
 * this uses whatever `SpeechRecognition` the platform exposes (Chrome/Edge ship
 * one; it may round-trip to a cloud service). The settings panel and the
 * first-use disclosure say so plainly.
 *
 * The listening logic lives in `startVoiceInput`, a framework-free controller
 * so it can be driven by a mocked recognition object in tests; `useVoiceInput`
 * is the thin React binding the composer uses.
 *
 * Decision: click-to-toggle, not press-and-hold. Hold gestures are unreliable
 * with a mouse, and the app's slide-to-cancel affordance has no web analogue.
 * `stop` hands the transcript back for review and never auto-sends; `cancel`
 * discards it.
 */

/** Hard stop: the app caps a single dictation at a minute. */
export const MAX_VOICE_MS = 60_000;

/** Minimal surface of the Web Speech API we depend on. */
export interface VoiceResultAlternative {
  transcript: string;
}

export interface VoiceResult {
  readonly 0: VoiceResultAlternative;
  isFinal: boolean;
}

export interface VoiceResultEvent {
  resultIndex: number;
  results: ArrayLike<VoiceResult>;
}

export interface VoiceRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: VoiceResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionFactory = () => VoiceRecognition;

/** Returns a factory for the platform recognizer, or null when unsupported. */
export function recognitionFactory(): RecognitionFactory | null {
  const scope = globalThis as unknown as {
    SpeechRecognition?: new () => VoiceRecognition;
    webkitSpeechRecognition?: new () => VoiceRecognition;
  };
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  return Ctor ? () => new Ctor() : null;
}

export interface VoiceCallbacks {
  /** Running transcript (finalised text plus the in-flight partial). */
  onInterim?: (text: string) => void;
  /** Delivered once on `stop`; never fired for a cancelled session. */
  onFinal?: (text: string) => void;
  /** `no-speech`, `not-allowed`, … — `aborted` is swallowed on cancel. */
  onError?: (code: string) => void;
  onListeningChange?: (listening: boolean) => void;
}

export interface VoiceSession {
  /** Finish dictating and deliver the final transcript. */
  stop(): void;
  /** Discard everything; no transcript is delivered. */
  cancel(): void;
}

/**
 * Begin a single dictation. Returns a handle to stop or cancel it.
 *
 * Multiple `result` events are folded together: finalised chunks accumulate and
 * the latest partial replaces itself, so callers always see one growing string.
 */
export function startVoiceInput(
  make: RecognitionFactory,
  callbacks: VoiceCallbacks = {},
  options: { lang?: string; maxMs?: number } = {},
): VoiceSession {
  const recognition = make();
  recognition.lang =
    options.lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let finalised = "";
  let cancelled = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimer();
    callbacks.onListeningChange?.(false);
    if (cancelled) return;
    const text = finalised.trim();
    if (text) callbacks.onFinal?.(text);
  }

  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) finalised += transcript;
      else interim += transcript;
    }
    callbacks.onInterim?.((finalised + interim).trim());
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") return;
    callbacks.onError?.(event.error);
  };

  recognition.onend = finish;

  try {
    recognition.start();
  } catch (error) {
    finished = true;
    callbacks.onError?.(error instanceof Error ? error.message : "start-failed");
    callbacks.onListeningChange?.(false);
    return { stop: () => {}, cancel: () => {} };
  }

  callbacks.onListeningChange?.(true);
  timer = setTimeout(() => {
    if (!finished) recognition.stop();
  }, options.maxMs ?? MAX_VOICE_MS);

  return {
    stop() {
      if (!finished) recognition.stop();
    },
    cancel() {
      cancelled = true;
      clearTimer();
      if (!finished) recognition.abort();
      else callbacks.onListeningChange?.(false);
    },
  };
}

export interface VoiceInputState {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
  start(): void;
  stop(): void;
  cancel(): void;
}

/** React binding for the composer: one dictation at a time, cleaned up on exit. */
export function useVoiceInput(onFinal: (text: string) => void): VoiceInputState {
  const [supported] = useState(() => recognitionFactory() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const start = useCallback(() => {
    const make = recognitionFactory();
    if (!make) return;
    setError(null);
    setInterim("");
    sessionRef.current = startVoiceInput(make, {
      onInterim: setInterim,
      onFinal: (text) => finalRef.current(text),
      onError: (code) => setError(code),
      onListeningChange: setListening,
    });
  }, []);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setInterim("");
  }, []);

  useEffect(() => () => sessionRef.current?.cancel(), []);

  return { supported, listening, interim, error, start, stop, cancel };
}
