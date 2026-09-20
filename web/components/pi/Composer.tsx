"use client";

import { useRef, useState } from "react";

import { CodexPrompt } from "@/components/brainless/codex/codex-prompt";
import type { WireImage, WireModel } from "@/lib/protocol/types";
import { useVoiceInput } from "@/lib/session/voice";

/**
 * Composer for a pi turn.
 *
 * Uses the brainless Codex composer because its footer line is honest for pi:
 * it shows the model the Pi reported and the directory/session being addressed.
 * (The Claude composer's footer is mode chrome — "auto mode on · ← for agents" —
 * that pi has no equivalent for.)
 *
 * Behaviour that mirrors the mobile app:
 *   - Enter sends, Escape interrupts the in-flight turn
 *   - while a turn is running the same Enter **steers** it instead of starting
 *     a second turn, and the footer says so
 *   - Enter during an IME composition is ignored so CJK input does not send a
 *     half-typed message
 *   - attachments are compressed on-device before they go on the wire
 */

/** Matches the app: JPEG, longest side ≤1568px, quality 0.8 (plan/30). */
const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.8;

export function Composer({
  disabled,
  working,
  model,
  currentModel,
  directory,
  queuedText,
  voiceNoticeAck,
  onAckVoiceNotice,
  onSend,
  onInterrupt,
  onQueue,
}: {
  disabled?: boolean;
  working?: boolean;
  model?: string;
  /** Full catalogue entry for the active model — drives the vision gate. */
  currentModel?: WireModel;
  directory: string;
  /** Draft the Pi is holding for this session, if any. */
  queuedText?: string;
  /** Whether the voice privacy disclosure has been acknowledged. */
  voiceNoticeAck?: boolean;
  onAckVoiceNotice?: () => void;
  onSend: (text: string, images?: WireImage[]) => void;
  onInterrupt: () => void;
  onQueue: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<WireImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Dictation lands in the draft for review; it is never sent on its own, which
  // is the app's rule too (a misheard word should not become a turn).
  const voice = useVoiceInput((text) => {
    setDraft((prev) => (prev ? `${prev} ${text}` : text));
  });

  function toggleVoice() {
    if (!voiceNoticeAck) {
      setVoiceNotice(true);
      return;
    }
    if (voice.listening) voice.stop();
    else voice.start();
  }

  function ackVoiceAndStart() {
    onAckVoiceNotice?.();
    setVoiceNotice(false);
    voice.start();
  }

  // The app gates attachments on the catalogue's `vision` flag: a text-only
  // model would receive an image it cannot read, so the affordance goes away
  // rather than failing at the Pi.
  const visionBlocked = !!currentModel && !currentModel.vision;

  function submit() {
    const text = draft.trim();
    if ((!text && images.length === 0) || disabled) return;
    setDraft("");
    setImages([]);
    onSend(text, images.length ? images : undefined);
  }

  async function attach(files: FileList | null) {
    if (!files?.length || visionBlocked) return;
    setAttachError(null);
    setBusy(true);
    try {
      // The protocol carries one image today (plan/30); extra files are ignored
      // rather than silently dropped, which is why the UI says so.
      const [file] = Array.from(files);
      setImages([await compressToWireImage(file)]);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "could not read that image");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="min-w-0">
      {images.length > 0 ? (
        <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px]" style={{ color: "var(--pi-muted)" }}>
          {images.map((image) => (
            <span
              key={image.data.slice(0, 24)}
              className="flex items-center gap-1 rounded-none border px-1.5 py-0.5"
              style={{ borderColor: "var(--pi-dim)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${image.mime};base64,${image.data}`}
                alt="attachment"
                className="h-6 w-6 object-cover"
              />
              <span>{Math.round((image.data.length * 3) / 4 / 1024)} KB</span>
              <button
                type="button"
                onClick={() => setImages([])}
                style={{ color: "var(--pi-dim)" }}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </span>
          ))}
          <span style={{ color: "var(--pi-dim)" }}>one image per message</span>
        </div>
      ) : null}

      <CodexPrompt
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // `isComposing` guards CJK/IME input: the Enter that confirms a
          // candidate must not also send the message.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onInterrupt();
          }
        }}
        placeholder={disabled ? "Connect a Pi to start typing…" : "Ask pi…"}
        model={model ?? "pi"}
        directory={directory}
        className={disabled ? "opacity-60" : undefined}
      />

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-[2ch] font-mono text-[11px] text-[var(--pi-codex-dim)]">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy || visionBlocked}
          title={visionBlocked ? "The current model cannot see images" : undefined}
          className="underline-offset-2 hover:underline disabled:opacity-50"
        >
          {busy ? "reading…" : "attach image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void attach(event.target.files)}
        />
        {voice.supported ? (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={disabled}
            className="underline-offset-2 hover:underline disabled:opacity-50"
            style={voice.listening ? { color: "var(--pi-red)" } : undefined}
            title="Dictate a message with your browser's speech service"
          >
            {voice.listening ? "stop voice" : "voice"}
          </button>
        ) : null}
        <span>{working ? "Enter to steer the running turn" : "Enter to send"}</span>
        {working ? (
          <button
            type="button"
            onClick={onInterrupt}
            disabled={disabled}
            className="underline-offset-2 hover:underline disabled:opacity-50"
            style={{ color: "var(--pi-yellow)" }}
            title="Stop the running turn"
          >
            interrupt
          </button>
        ) : null}
        {working ? (
          <button
            type="button"
            onClick={() => onQueue(draft)}
            disabled={!draft.trim()}
            className="underline-offset-2 hover:underline disabled:opacity-50"
            title="Hold this draft on the Pi and send it when the current turn ends"
          >
            queue for later
          </button>
        ) : null}
        {queuedText ? (
          <button
            type="button"
            onClick={() => {
              // Pull the Pi-held draft back into the composer and release the
              // queue in one move, matching the app's tap-to-edit behaviour.
              setDraft(queuedText);
              onQueue("");
            }}
            className="text-left underline-offset-2 hover:underline"
            style={{ color: "var(--pi-yellow)" }}
            title="Pull this queued draft back into the composer"
          >
            queued: {queuedText}
          </button>
        ) : null}
        {attachError ? <span style={{ color: "var(--pi-red)" }}>{attachError}</span> : null}
      </div>

      {voice.listening && voice.interim ? (
        <p className="mt-1 pl-[2ch] font-mono text-[11px]" style={{ color: "var(--pi-cyan)" }}>
          {voice.interim}
        </p>
      ) : null}
      {voice.error ? (
        <p className="mt-1 pl-[2ch] font-mono text-[11px]" style={{ color: "var(--pi-red)" }}>
          voice: {voice.error}
        </p>
      ) : null}
      {voiceNotice ? (
        <p
          className="mt-1 flex flex-wrap items-baseline gap-x-2 pl-[2ch] font-mono text-[11px]"
          style={{ color: "var(--pi-muted)" }}
        >
          <span>Voice uses your browser&apos;s speech service — audio may leave this device.</span>
          <button
            type="button"
            onClick={ackVoiceAndStart}
            className="underline-offset-2 hover:underline"
            style={{ color: "var(--pi-rose)" }}
          >
            got it
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Downscale + re-encode on-device before sending.
 *
 * Same budget the mobile app uses (JPEG, longest side ≤1568px, q0.8). Doing it
 * here keeps the wire payload small and strips EXIF as a side effect, since the
 * canvas re-encode does not carry metadata across.
 */
export async function compressToWireImage(file: File): Promise<WireImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name || "file"} is not an image`);
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("could not encode the image");

  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);

  return { data: btoa(binary), mime: "image/jpeg" };
}
