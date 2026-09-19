import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_VOICE_MS,
  recognitionFactory,
  startVoiceInput,
  type VoiceRecognition,
  type VoiceResultEvent,
} from "@/lib/session/voice";

class MockRecognition implements VoiceRecognition {
  lang = "";
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  onresult: ((event: VoiceResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  private results: Array<{ 0: { transcript: string }; isFinal: boolean }> = [];

  start() {
    this.starts += 1;
  }

  stop() {
    this.stops += 1;
    this.onend?.();
  }

  abort() {
    this.aborts += 1;
    this.onend?.();
  }

  emit(text: string, isFinal: boolean) {
    // The real API reports cumulative results with `resultIndex` pointing at the
    // first result that changed; a pending partial is replaced in place.
    const last = this.results.at(-1);
    if (last && !last.isFinal) this.results[this.results.length - 1] = { 0: { transcript: text }, isFinal };
    else this.results.push({ 0: { transcript: text }, isFinal });
    this.onresult?.({
      resultIndex: this.results.length - 1,
      results: this.results,
    });
  }
}

function harness() {
  const recognition = new MockRecognition();
  const events = {
    interim: [] as string[],
    final: [] as string[],
    errors: [] as string[],
    listening: [] as boolean[],
  };
  const session = startVoiceInput(() => recognition, {
    onInterim: (text) => events.interim.push(text),
    onFinal: (text) => events.final.push(text),
    onError: (code) => events.errors.push(code),
    onListeningChange: (listening) => events.listening.push(listening),
  });
  return { recognition, session, events };
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).SpeechRecognition;
  delete (globalThis as Record<string, unknown>).webkitSpeechRecognition;
});

describe("recognitionFactory", () => {
  it("returns null when the platform has no recognizer", () => {
    expect(recognitionFactory()).toBeNull();
  });

  it("picks up the standard constructor and the webkit prefix", () => {
    (globalThis as Record<string, unknown>).SpeechRecognition = MockRecognition;
    expect(recognitionFactory()).not.toBeNull();
    delete (globalThis as Record<string, unknown>).SpeechRecognition;

    (globalThis as Record<string, unknown>).webkitSpeechRecognition = MockRecognition;
    expect(recognitionFactory()).not.toBeNull();
  });
});

describe("startVoiceInput", () => {
  it("configures the recognizer for single-shot dictation", () => {
    const { recognition, events } = harness();
    expect(recognition.interimResults).toBe(true);
    expect(recognition.continuous).toBe(false);
    expect(recognition.maxAlternatives).toBe(1);
    expect(recognition.lang).toBeTruthy();
    expect(recognition.starts).toBe(1);
    expect(events.listening).toEqual([true]);
  });

  it("folds partial results and delivers the final transcript on stop", () => {
    const { recognition, session, events } = harness();
    recognition.emit("hello ", true);
    recognition.emit("wor", false);
    expect(events.interim.at(-1)).toBe("hello wor");

    recognition.emit("world", false);
    expect(events.interim.at(-1)).toBe("hello world");
    recognition.emit("world", true);
    session.stop();
    expect(events.final).toEqual(["hello world"]);
    expect(events.listening).toEqual([true, false]);
  });

  it("discards the transcript when cancelled", () => {
    const { recognition, session, events } = harness();
    recognition.emit("secret", true);
    session.cancel();
    expect(recognition.aborts).toBe(1);
    expect(events.final).toEqual([]);
    expect(events.listening).toEqual([true, false]);
  });

  it("surfaces recognizer errors but ignores aborts", () => {
    const { recognition, events } = harness();
    recognition.onerror?.({ error: "aborted" });
    expect(events.errors).toEqual([]);
    recognition.onerror?.({ error: "not-allowed" });
    expect(events.errors).toEqual(["not-allowed"]);
  });

  it("stops itself at the client cap", () => {
    vi.useFakeTimers();
    const { recognition, events } = harness();
    recognition.emit("timed out", true);
    vi.advanceTimersByTime(MAX_VOICE_MS);
    expect(recognition.stops).toBe(1);
    expect(events.final).toEqual(["timed out"]);
  });

  it("reports a start failure instead of throwing", () => {
    const broken: VoiceRecognition = {
      lang: "",
      interimResults: false,
      continuous: true,
      maxAlternatives: 1,
      onresult: null,
      onerror: null,
      onend: null,
      start() {
        throw new Error("denied by policy");
      },
      stop() {},
      abort() {},
    };
    const errors: string[] = [];
    const listening: boolean[] = [];
    expect(() =>
      startVoiceInput(() => broken, {
        onError: (code) => errors.push(code),
        onListeningChange: (value) => listening.push(value),
      }),
    ).not.toThrow();
    expect(errors).toEqual(["denied by policy"]);
    expect(listening).toEqual([false]);
  });
});
