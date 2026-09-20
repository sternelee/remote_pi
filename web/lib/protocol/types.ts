/**
 * Wire types for the Remote Pi protocol — the browser-client subset.
 *
 * Source of truth: `PROTOCOL.md`, `.orchestration/contracts/protocol.md` and
 * `pairing.md`. The canonical TS implementation lives in
 * `pi-extension/src/protocol/types.ts`; this file mirrors the client half
 * (what an app peer sends and receives) so the shapes cannot drift silently.
 * `test/fixtures.test.ts` runs the codec against the shared
 * `.orchestration/contracts/fixtures/*.jsonl` vectors.
 *
 * Naming is snake_case to match the wire. `ErrorCode` is deliberately open —
 * unknown codes must be tolerated for forward compatibility.
 */

// ── Envelope ───────────────────────────────────────────────────────────────

/** Outer envelope: routing only, opaque `ct` to the relay. */
export interface OuterEnvelope {
  /** Destination (outbound) / sender (inbound) — standard base64 Ed25519 pubkey. */
  peer: string;
  /** Sub-channel on the peer. `"main"` for app peers. */
  room?: string;
  /** base64 of the inner envelope's UTF-8 JSON. Plaintext post-plan-06. */
  ct: string;
}

// ── Client → Pi (inner) ────────────────────────────────────────────────────

export type StreamingBehavior = "steer";

export interface WireImage {
  /** Base64-encoded image bytes. */
  data: string;
  /** MIME type, e.g. `image/jpeg`. */
  mime: string;
}

/** One slash command Pi can execute, from the SDK's `getCommands()`. */
export interface WireCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
}

/** One question's answered parts. Keys mirror pi-ask's own schema verbatim. */
export interface AskAnswerWire {
  /** Option *values* (not labels) for single/multi questions. */
  values?: string[];
  customText?: string;
  note?: string;
  optionNotes?: Record<string, string>;
}

/**
 * Structured answer for a pi-ask flow, echoed on `extension_ui_response.ask`.
 *
 * A client that rendered the full flow from the `ask` envelope submits ONLY
 * this envelope — the structured `answers` supersede the `value`/`confirmed`
 * discriminators, and the Pi routes on `ask.kind` before reading any of them.
 */
export type AskResponseEnrichmentWire =
  | {
      flow_id: string;
      kind: "answer";
      mode?: "submit" | "elaborate";
      answers: Record<string, AskAnswerWire>;
    }
  | { flow_id: string; kind: "cancel" };

/**
 * Response to an `extension_ui_request`.
 *
 * `id` is the **request's** id (the bridge keys on it; for pi-ask flows it is
 * also the flow id). Two shapes:
 *   - degraded: `value` (the option **label**) or `confirmed`, no `ask`
 *   - rich: `ask` only, carrying option **values**
 */
export type ExtensionUiResponseWire =
  | { type: "extension_ui_response"; id: string; value: string; ask?: AskResponseEnrichmentWire }
  | { type: "extension_ui_response"; id: string; confirmed: boolean; ask?: AskResponseEnrichmentWire }
  | { type: "extension_ui_response"; id: string; cancelled: true; ask?: AskResponseEnrichmentWire }
  | { type: "extension_ui_response"; id: string; ask: AskResponseEnrichmentWire };

export type ClientMessage =
  | { type: "pair_request"; id: string; token: string; device_name: string }
  | {
      type: "user_message";
      id: string;
      text: string;
      images?: WireImage[];
      streaming_behavior?: StreamingBehavior;
    }
  /** Draft held on the Pi while a turn is running (plan/28 queue surface). */
  | { type: "queued_message_set"; id: string; text: string }
  | { type: "queued_message_clear"; id: string; target_id?: string }
  | { type: "approve_tool"; id: string; tool_call_id: string; decision: "allow" | "deny" }
  | { type: "cancel"; id: string; target_id: string }
  | { type: "ping"; id: string }
  | { type: "session_sync"; id: string; limit?: number }
  | { type: "session_new"; id: string }
  | { type: "session_compact"; id: string }
  | { type: "model_set"; id: string; provider: string; model_id: string }
  | { type: "thinking_set"; id: string; level: ThinkingLevel }
  | { type: "list_models"; id: string }
  | { type: "list_commands"; id: string }
  | ExtensionUiResponseWire;

// ── Pi → Client (inner) ────────────────────────────────────────────────────

export type PairErrorCode =
  | "token_expired"
  | "token_consumed"
  | "token_unknown"
  | "internal_error";

export type KnownErrorCode =
  | "unknown_peer"
  | "tool_approval_required"
  | "invalid_message"
  | "unsupported_type"
  | "too_large"
  | "rate_limited"
  | "timeout"
  | "internal_error"
  | "auth_failed";

export type ErrorCode = KnownErrorCode | (string & {});

export type Usage = { input_tokens: number; output_tokens: number };

export type ByeReason = "peer_stop" | "session_replaced" | "shutdown";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Typed app actions that get an `action_ok`/`action_error` reply. */
export type ActionName = "session_new" | "session_compact" | "model_set" | "thinking_set";

/**
 * SDK UI methods mirrored by `extension_ui_request` (plan/57).
 *
 * The first five are interactive prompts that expect an `extension_ui_response`;
 * the last four are one-way display-only controls (plan/65) that mutate
 * ephemeral session UI state and are never answered.
 */
export type ExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text";

/** One option of an interactive prompt (pi-ask enrichment or SDK `select`). */
export interface AskOptionWire {
  value: string;
  label: string;
  description?: string;
  preview?: string;
  freeform?: boolean;
}

export interface AskQuestionWire {
  id: string;
  label: string;
  prompt: string;
  type: "single" | "multi" | "preview";
  required: boolean;
  presentedType?: "single" | "multi" | "preview";
  requestedType?: "single" | "multi" | "preview";
  options: AskOptionWire[];
}

export interface AskEnrichmentWire {
  flow_id: string;
  tool_call_id: string | null;
  source: string;
  title: string | null;
  questions: AskQuestionWire[];
}

/**
 * Interactive prompt pushed by the Pi (plan/57). `ask` is present when the
 * prompt came from a pi-ask flow and carries the full question schema; without
 * it the SDK method/options drive a degraded but valid render.
 */export type ExtensionUiRequestWire =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      ask?: AskEnrichmentWire;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      ask?: AskEnrichmentWire;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input" | "editor";
      title: string;
      placeholder?: string;
      ask?: AskEnrichmentWire;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notify_type?: string;
      ask?: AskEnrichmentWire;
    }
  /**
   * One-way control (plan/65): set/clear a status line entry. A missing or
   * empty `status_text` removes `status_key`. No response is expected.
   */
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      status_key: string;
      status_text?: string;
    }
  /**
   * One-way control (plan/65): set/clear a widget block. A missing or empty
   * `widget_lines` removes `widget_key`; `widget_placement` defaults to
   * `"aboveEditor"`. No response is expected.
   */
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widget_key: string;
      widget_lines?: string[];
      widget_placement?: "aboveEditor" | "belowEditor";
    }
  /** One-way control (plan/65): set the session window title. */
  | {
      type: "extension_ui_request";
      id: string;
      method: "setTitle";
      title: string;
    }
  /** One-way control (plan/65): replace the composer draft. */
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    };

export interface WireModel {
  /** Stable identifier inside the provider's catalog, e.g. `claude-opus-4-7`. */
  id: string;
  /** Display name for the picker row, e.g. `Claude Opus 4.7`. */
  name: string;
  /** Provider slug, e.g. `anthropic`. */
  provider: string;
  /** Whether the model supports the thinking surface. */
  reasoning: boolean;
  /** Context window in tokens. */
  context_window: number;
  /** True when the model accepts image input. */
  vision: boolean;
}

/** One entry of the Pi-side draft queue, pushed via `queued_message_state`. */
export interface QueuedMessageItem {
  id: string;
  text: string;
  editable: boolean;
  created_at: number;
}

/** Replayable history event: a server message shape plus a timestamp. */
export type SessionHistoryEvent =
  | ({ ts: number } & Extract<ServerMessage, { type: "user_input" }>)
  | ({ ts: number } & Extract<ServerMessage, { type: "user_message" }>)
  | ({ ts: number } & Extract<ServerMessage, { type: "agent_message" }>)
  | { ts: number; type: "thinking"; in_reply_to: string; text: string }
  | { ts: number; type: "custom"; custom_type: string; content: unknown; display: boolean; details?: unknown }
  | ({ ts: number } & Extract<ServerMessage, { type: "tool_request" }>)
  | ({ ts: number } & Extract<ServerMessage, { type: "tool_result" }>)
  | ({ ts: number } & Extract<ServerMessage, { type: "compaction" }>);

export type ServerMessage =
  | {
      type: "pair_ok";
      in_reply_to: string;
      session_name: string;
      session_started_at: number;
      room_id: string;
      harness?: { name: string; version: string };
      hostname?: string;
    }
  | { type: "pair_error"; in_reply_to: string; code: PairErrorCode; message: string }
  | { type: "user_input"; id: string; text: string; streaming_behavior?: StreamingBehavior }
  /** Echo of an app-sent `user_message`, broadcast to every paired owner. */
  | {
      type: "user_message";
      id: string;
      text: string;
      images?: WireImage[];
      streaming_behavior?: StreamingBehavior;
    }
  /** The Pi accepted a `streaming_behavior: "steer"` message into the live turn. */
  | { type: "steer_consumed"; id: string }
  /** Snapshot of the Pi-side draft queue (also sent in response to session_sync). */
  | { type: "queued_message_state"; id?: string; text?: string; items?: QueuedMessageItem[] }
  | { type: "agent_chunk"; in_reply_to: string; delta: string }
  /**
   * Reasoning delta. Kept separate from `agent_chunk` because the reducer
   * aggregates chunks by `in_reply_to`; folding reasoning into the answer
   * stream would corrupt the assistant bubble.
   */
  | { type: "agent_thinking_chunk"; in_reply_to: string; delta: string }
  | { type: "agent_done"; in_reply_to: string; usage?: Usage }
  | { type: "agent_message"; in_reply_to: string; text: string; usage?: Usage }
  /**
   * Plugin-authored custom message (`pi.sendMessage` / `role:"custom"`). The
   * text lives in `content` (string or content blocks) and the plugin tags it
   * with `custom_type`; `display:false` means it targets the model, not the UI.
   */
  | { type: "custom_message"; custom_type: string; content: unknown; display: boolean; details?: unknown }
  | { type: "compaction"; summary: string; tokens_before: number; ts?: number }
  | { type: "tool_request"; tool_call_id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool_call_id: string; result?: unknown; error?: string }
  | { type: "error"; in_reply_to?: string; code: ErrorCode; message: string }
  | { type: "cancelled"; in_reply_to: string; target_id: string }
  | { type: "pong"; in_reply_to: string }
  | { type: "bye"; reason: ByeReason }
  | {
      type: "session_history";
      in_reply_to: string;
      session_started_at: number;
      events: SessionHistoryEvent[];
      eos: boolean;
      truncated: boolean;
    }
  | { type: "models_list"; in_reply_to: string; models: WireModel[]; current?: WireModel }
  | { type: "commands_list"; in_reply_to: string; commands: WireCommand[] }
  | { type: "action_ok"; in_reply_to: string; action: ActionName }
  | { type: "action_error"; in_reply_to: string; action: ActionName; error: string }
  | ExtensionUiRequestWire;

// ── Control frames (app ⇄ relay, never enveloped) ──────────────────────────

export type ControlOutbound =
  | { type: "hello"; pubkey: string; room_id?: string; room_meta?: RoomMeta }
  | { type: "auth"; sig: string }
  | { type: "subscribe_presence"; peers: string[] }
  | { type: "unsubscribe_presence"; peers: string[] }
  | { type: "presence_check"; peers: string[] }
  | { type: "subscribe_rooms"; peers: string[] }
  | { type: "unsubscribe_rooms"; peers: string[] }
  | { type: "rooms_check"; peers: string[] };

export interface RoomMeta {
  name: string;
  cwd: string;
  model?: string;
  /** Plan/28: the relay broadcasts the Pi's thinking level alongside the model. */
  thinking?: ThinkingLevel;
  working?: boolean;
}

export type ControlInbound =
  | { type: "challenge"; nonce: string }
  | { type: "peer_online"; peer: string }
  | { type: "peer_offline"; peer: string; since_ts?: number }
  | {
      type: "presence";
      states: { peer: string; online: boolean; since_ts: number | null }[];
    }
  | { type: "room_announced"; peer: string; room_id: string; name?: string; cwd?: string; model?: string; thinking?: ThinkingLevel; started_at: number }
  | { type: "room_ended"; peer: string; room_id: string; since_ts: number }
  | { type: "room_meta_updated"; peer: string; room_id: string; meta: { model?: string | null; thinking?: ThinkingLevel | null; working?: boolean } }
  | {
      type: "rooms";
      peer: string;
      rooms: {
        room_id: string;
        name?: string;
        cwd?: string;
        model?: string;
        thinking?: ThinkingLevel;
        started_at: number;
      }[];
    };

/** Relay close reasons surfaced as a trustworthy `transport_error` reason. */
export type TransportErrorReason = "offline" | "not_authorized" | "bad_envelope";
