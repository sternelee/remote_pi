# 65 — Pi plugin support (remote clients)

**Status:** in progress. Primitives C and A are done; B is next; D is delivered by B.

## Context

Pi users install plugins (`pi install npm:<pkg>`). Remote clients (web PWA, and
later the app) only see a hard-coded subset of events, so common plugins are
invisible. Target plugins:

`pi-ask-user`, `pi-subagents`, `pi-btw`, `@devkade/pi-plan`, `@capyup/pi-goal`,
`pi-rewind`, `@juicesharp/rpiv-todo`.

Four generic primitives cover them:

| Primitive | What it adds | Status |
|---|---|---|
| **A** — remote slash commands | enumerate via `pi.getCommands()`, execute `/cmd` through Pi's dispatcher | done |
| **B** — `ctx.ui.*` forwarding | `select`/`confirm`/`input`/`editor`/`notify` + `setStatus`/`setWidget`/`setTitle`/`set_editor_text` reach the client | **this doc** |
| **C** — custom messages | forward `role:"custom"` (`pi.sendMessage`) | done |
| **D** — `pi-ask-user` | its `ask_user` tool is usable remotely | delivered by B |

### A (done)

`list_commands {id}` → `commands_list {in_reply_to, commands: WireCommand[]}`
(`WireCommand = {name, description?, source: "extension"|"prompt"|"skill"}`).
A `user_message` whose trimmed text starts with `/` is routed in daemon mode
through the supervisor `send` op (RPC `prompt`), which expands extension
commands, prompt templates and skills; otherwise it falls back to a normal
message. TUI builtins (`/compact`, `/model`) stay on typed actions.

### C (done)

`custom_message {custom_type, content, display, details?}` live, and the
`custom` history event. `display:false` targets the model, not the UI.

## Why B also delivers D

The daemon runs Pi as an **RPC child** (`pi --mode rpc --approve -e <dist>`).
In RPC mode the SDK binds a real UI context, so:

- `ctx.hasUI` is `true`;
- `ctx.ui.custom()` returns `undefined`;
- `ctx.ui.select/confirm/input/editor/notify` and
  `setStatus/setWidget/setTitle/set_editor_text` are emitted as
  `extension_ui_request` frames on the child's **stdout**;
- the child reads `extension_ui_response` frames from its **stdin**.

`pi-ask-user` degrades to `ctx.ui.select`/`ctx.ui.input` (`askViaDialogs`) when
`ctx.ui.custom()` returns undefined. So once B forwards those frames and routes
responses back, `ask_user` works with **no monkey-patching**. Today the
supervisor drops those frames, so `ask_user` hangs.

## B architecture

```
pi child (RPC) ──stdout: extension_ui_request──▶ RpcChild.emit("stdout")
                                                   │
                                       Supervisor: parse + route by daemon id
                                                   │  (persistent UDS)
                                                   ▼
                        extension in the pi child  (supervisor_ui_bridge)
                                                   │  relay frames
                                                   ▼
                                         paired web clients
                                                   │  extension_ui_response
                                                   ▼
                        supervisor_ui_bridge ──UDS──▶ Supervisor
                                                   │  RpcChild.sendUiResponse
                                                   ▼
                                          pi child stdin
```

### 1. Supervisor ↔ extension UI channel

A dedicated persistent UDS, separate from the one-shot control socket (which is
documented "no multiplexing, no streaming").

- Path: `<supervisor dir>/ui.sock` (same dir as `supervisor.sock`).
- The supervisor listens; the extension connects at `session_start` when
  `REMOTE_PI_DAEMON === "1"`.
- Extension → supervisor first line: `{op:"ui_hello", daemon_id, cwd}`.
- Supervisor → extension: `{op:"ui_request", frame: <RPC extension_ui_request>}`.
- Extension → supervisor: `{op:"ui_response", id, value?|confirmed?|cancelled?}`.
- Newline-delimited JSON, many frames per connection (streaming).

`daemon_id` is `daemonIdForCwd(cwd)` (already used by the `send` op).

### 2. RpcChild

- Already emits `"stdout"` for every line (nobody listens today).
- New method `sendUiResponse(response: {id, value?|confirmed?|cancelled?})`
  writes `{type:"extension_ui_response", id, …}\n` to the child's stdin
  (mirrors `sendPrompt`).

### 3. Supervisor

- Subscribe to each child's `"stdout"`; when a line parses as
  `{type:"extension_ui_request", id, method, …}`, forward it to the extension
  connection registered for that daemon id.
- Keep a `Map<daemonId, socket>` and reverse `Map<socket, daemonId>`.
- On `{op:"ui_response"}`, call `slot.child.sendUiResponse(...)`.
- Reap sockets on close; drop frames when no extension is connected.

### 4. Extension side (`supervisor_ui_bridge.ts`)

- Connects/reconnects to the UI socket while the session is alive; sends
  `ui_hello` with its daemon id.
- For each RPC frame, maps it to a relay `extension_ui_request` and broadcasts
  to active peers (`_broadcastToActive`).
- Interactive methods (`select`/`confirm`/`input`/`editor`) register a pending
  request keyed by a **namespaced** id (`ui:<id>`) so it cannot collide with
  pi-ask flow ids; the first client response wins and is written back.
- Non-interactive methods (`notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`) are broadcast fire-and-forget (no pending entry).
- Inbound `extension_ui_response` in `index.ts` is routed to this bridge when
  the id starts with `ui:`, else to the existing pi-ask bridge.

### 5. Relay wire (`pi-extension/src/protocol/types.ts` + `codec.ts`)

Extend `ExtensionUiMethod` with `setStatus`, `setWidget`, `setTitle`,
`set_editor_text`, and add matching `ExtensionUiRequestWire` variants:

- `{type:"extension_ui_request", id, method:"setStatus", status_key: string, status_text?: string}`
- `{type:"extension_ui_request", id, method:"setWidget", widget_key: string, widget_lines?: string[], widget_placement?: "aboveEditor"|"belowEditor"}`
- `{type:"extension_ui_request", id, method:"setTitle", title: string}`
- `{type:"extension_ui_request", id, method:"set_editor_text", text: string}`

`select`/`confirm`/`input`/`editor` keep the existing variants (they already
carry `title`/`options`/`placeholder`/`prefill`). `notify` already exists.
Responses stay `value` / `confirmed` / `cancelled`.

### 6. Web rendering

- Interactive `select`/`confirm`/`input`/`editor`: **no change** — `questionsOf`
  already normalizes them into `QuestionPrompt`.
- `notify` → existing notice/toast path.
- `setStatus` → session-level status map (`status_key → status_text`), rendered
  in the rail next to the working indicator; `status_text: undefined` clears it.
- `setWidget` → session-level widget map (`widget_key → lines[]`), rendered as a
  small block above the composer (`aboveEditor`) or below it; `undefined`
  clears it.
- `setTitle` → overrides the session title shown in the rail / document title.
- `set_editor_text` → sets the composer draft (respecting an in-progress edit:
  only fill when the draft is empty, matching the app's "drop transcript into
  the field" behaviour).

These four are **session state, not transcript entries** (they are not replayed
by `session_history`), so they live in `usePiSession` state, not the reducer.

## Out of scope

- Upstreaming a submit event into `pi-ask-user` (would remove the need for B's
  RPC path, but B is more general).
- TUI-only surfaces (`ctx.ui.custom`, `setFooter`, `setHeader`,
  `onTerminalInput`) — no-ops in RPC mode.
- Rich widget rendering beyond plain text lines.

## Files

pi-extension:

- `src/daemon/ui_protocol.ts` (new) — UI channel frame types + codec helpers.
- `src/daemon/rpc_child.ts` — `sendUiResponse`.
- `src/daemon/supervisor.ts` — listen to child stdout, host the UI socket,
  route frames/responses.
- `src/supervisor_ui_bridge.ts` (new) — extension-side bridge.
- `src/protocol/types.ts`, `src/protocol/codec.ts` — new UI methods.
- `src/index.ts` — create/teardown the bridge at session start/shutdown; route
  inbound responses.

web:

- `lib/protocol/types.ts` — new methods + wire variants.
- `lib/session/usePiSession.ts` — status/widget/title/editor state + cases.
- `lib/session/transcript.ts` — keep the four out of the timeline.
- `components/pi/SessionScreen.tsx` — render status + widget; title.
- `components/pi/Composer.tsx` — accept `set_editor_text`.

contracts:

- `.orchestration/contracts/fixtures/` — a `plugin_ui.jsonl` fixture; bump the
  fixture count in both pi-extension tests and `SERVER_TYPE_FILES`.
- `PROTOCOL.md` — document the four new methods and the RPC bridge.

## Verification

- pi-extension: `pnpm typecheck` + `pnpm test`.
- web: `./node_modules/.bin/tsc --noEmit`,
  `./node_modules/.bin/vitest run --config vitest.config.ts`,
  `./node_modules/.bin/vinext build`.
- Manual: `ask_user` in a daemon session renders a prompt and answers.
