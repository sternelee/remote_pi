# Remote Pi — Web (PWA)

Browser client for the Pi coding agent. Pairs with a Pi over the relay — the
same protocol the Flutter app speaks — and renders the session live as a
terminal scrollback.

Built with [vinext](https://github.com/cloudflare/vinext) (the Next.js 16 API
surface on Vite) and deployed as a Cloudflare Worker. The UI uses the
[brainless](https://brainless.swerdlow.dev/components) terminal component
registry, vendored into `components/brainless/`.

## Why it exists

The Flutter app covers iOS/Android. This covers everything with a browser —
desktop, tablet, a locked-down work machine — and installs as a PWA, so there is
no store review in the loop.

## Commands

```bash
pnpm install
pnpm dev          # vinext dev server (http://localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest: codec, transcript reducer, markdown, voice, render, relay
pnpm build        # production Worker output in dist/
pnpm start        # serve the built Worker locally (wrangler dev, :8787)
pnpm deploy       # vinext-cloudflare deploy → Cloudflare Workers
```

`pnpm test` is fully offline. Two opt-in integration tests drive the shipping
client against the real relay:

```bash
# Against a fake Pi peer started in-process (deterministic, no real Pi needed)
PI_LIVE=1 pnpm test

# Against a real Pi, using the link `/remote-pi pair` printed
PI_PAIR_LINK='remotepi://pair?t=…&epk=…&n=…&rm=…' pnpm test
```

`PI_LIVE=1` is the stronger of the two: both ends run in-process, so the peer
records every frame it received and the assertions prove a message *arrived and
was understood* rather than only that it was written to a socket.

## Deploying

`pnpm deploy` needs Cloudflare credentials (`wrangler login`, or
`CLOUDFLARE_API_TOKEN` in the environment) and a `name` in `wrangler.jsonc`.
Nothing else about the app is server-side: there is no KV, D1 or R2 binding, and
the Worker only serves the shell. All protocol work happens in the browser.

`web/` is not wired into `.github/workflows/` — deploy is manual for now.

## Architecture

```
app/page.tsx                server component — prerendered shell
components/pi/PiApp.tsx     client shell: home/session/pair routing + service worker
components/pi/*             home screen, pair screen, session screen, transcript,
                            composer, quick actions, prompt renderer, markdown,
                            settings, session info
components/ui/*             shadcn primitives (Dialog, Command) on Radix + cmdk
lib/protocol/{types,codec,uuid7}.ts   wire types, envelope codec, UUIDv7
lib/crypto/ed25519.ts       WebCrypto Ed25519 identity
lib/storage/store.ts        IndexedDB: identity, paired peers, settings
lib/pairing/qr.ts           remotepi:// payload parsing, relay URL handling
lib/relay/client.ts         WebSocket + challenge-response + reconnect
lib/session/transcript.ts   protocol messages → timeline (pure, tested)
lib/session/answers.ts      prompt answer construction, both wire paths (pure)
lib/session/voice.ts        Web Speech API dictation (pure controller + hook)
lib/session/route.ts        URL-hash routing (home / pair / session)
lib/theme.ts                theme mode + resolved-theme store
lib/session/usePiSession.ts React glue
```

`vite.config.ts` also carries the PWA setup (`vite-plugin-pwa`/Workbox), which
generates the manifest and service worker into `dist/client` at build time.

`app/page.tsx` stays a server component so the shell prerenders; everything
interactive lives under a `"use client"` boundary, because WebCrypto, WebSocket
and IndexedDB have no server-side equivalent.

The protocol is **not reimplemented by guesswork**: `lib/protocol/types.ts`
mirrors `pi-extension/src/protocol/types.ts`, and the codec is tested against
the shared vectors in `.orchestration/contracts/fixtures/*.jsonl` — the same
bytes the Dart and Rust implementations decode. See
[`../PROTOCOL.md`](../PROTOCOL.md) and
[`.orchestration/contracts/protocol.md`](../.orchestration/contracts/protocol.md).

### Two things the browser forces

**Identity storage.** The mobile app keeps its Ed25519 key in the OS Keychain;
a browser has no equivalent, so the key lives in IndexedDB as a JWK. That is a
real reduction in protection — the same trade-off the extension already makes on
headless Linux. It is the cost of having no installable native client.

**Liveness detection.** The relay pings every 25s, but browsers hide WebSocket
control frames from JavaScript, so the Node extension's "nothing arrived for N
seconds" watchdog would fire on a healthy idle connection. Liveness is measured
with the protocol's own `ping`/`pong` plus a dead-socket watchdog on *observable*
traffic (see the header comment in `lib/relay/client.ts`).

## What is implemented

- Device identity (Ed25519, WebCrypto), pairing by pasted link or camera QR
  (`BarcodeDetector`, Chromium/Android only), relay URL configuration with
  QR/relay mismatch detection, and reconnect to the remembered peer on open
- Relay handshake (`hello` → `challenge` → `auth`), reconnect with backoff,
  protocol ping, dead-socket detection
- Room addressing from the QR's `rm` and `pair_ok.room_id`, inbound room
  filtering, and `subscribe_rooms`/`rooms_check` discovery that retargets the
  room and surfaces the Pi's current model and thinking level
- **Multi-project home** — every paired Pi advertises its rooms and presence over
  the control channel (`subscribe_rooms`/`subscribe_presence`, one socket for all
  peers), so the landing screen lists each `peer × room` with a live dot
  (working/online/offline), its working directory, model and host, plus
  All/Online/Offline filters; opening a row retargets the connection to that room.
  The active view is mirrored in the URL hash (`#/`, `#/pair`,
  `#/session/<epk>/<room>`), so a reload or a shared link reopens the same room
- Session mirror (`session_sync`) on every connect **and** reconnect
- Transcript: user turns, streamed agent output, tool calls with results,
  unified diffs, compaction, errors, `bye`, and interactive prompts
- Composer with IME-safe Enter, interrupt via `cancel`, and **steering**: while a
  turn runs, Enter folds the text into it (`streaming_behavior: "steer"`) and
  the transcript shows `steering…` until the Pi answers `steer_consumed`
- **Agent markdown** — replies render through [Streamdown](https://streamdown.ai)
  (GFM tables, headings, lists, blockquotes, inline code) with the incomplete
  markdown repaired live as deltas arrive, so a half-written fence or emphasis
  never flashes raw syntax. Shiki highlights code (tokyo-night in dark,
  github-light in light) and each block gets a copy control; model-authored links stay behind Streamdown's
  confirmation modal and raw HTML is neutralised rather than injected
- **Reasoning** — models that think stream `agent_thinking_chunk` deltas into a
  collapsed `<details>` block above the answer (labelled `thinking…` while
  live), kept in a separate timeline entry from the reply so the two never
  interleave; `agent_done` and `cancelled` close the stream
- **Plugin messages** — third-party Pi plugins surface through `custom_message`
  frames (from the SDK's `role: "custom"`): the transcript shows the plugin's
  `custom_type` label with its content, an expandable `details` payload, and
  hides messages a plugin marked `display: false` (model-directed only)
- **Slash commands** — the composer opens a command picker when the draft starts
  with `/`, listing the commands Pi exposes via `pi.getCommands()` (extensions,
  prompt templates and skills); picking one fills `/<name> `, and sending it runs
  through Pi's command dispatcher instead of the model
- **Image attachments** — one per message, downscaled and re-encoded on-device
  (JPEG, longest side ≤1568px, q0.8) before they go on the wire; the attach
  control greys out when the active model has no `vision`
- **Received images** — inbound attachments (history replay or live) render as
  thumbnails on the user turn and open full size in a new tab
- **Message lifecycle** — a sent turn shows `· sending…` until its echo arrives,
  or `· not delivered` if 20 seconds pass with no confirmation, matching the
  app's silent-reap window
- **Quick actions** — a shadcn `Command` palette (Radix dialog + cmdk) with
  multi-level navigation: `session_compact`, `session_new` (behind a confirm
  step), a six-level thinking control (`thinking_set`) that greys out levels for
  non-reasoning models, and a model picker fed by `list_models` → `models_list`
  → `model_set` with provider filtering
- **Session info** — name, host, path (cwd), room, model, thinking, relay and
  pairing time, with the Pi's public key truncated
- **Editable draft queue**: hold a draft on the Pi while a turn runs
  (`queued_message_set`/`clear`, echoed back via `queued_message_state`); the
  queued preview is a button that pulls the text back into the composer
- **Voice input** — click-to-toggle dictation over the Web Speech API (shown only
  where the platform exposes it), capped at 60s, with a one-time disclosure. The
  transcript lands in the composer for review and is never auto-sent
- **Settings panel** off the status rail: relay URL (validated, save reconnects),
  an appearance switcher (system / light / dark), a `hide tool calls` toggle that
  drops tool/diff rows from the transcript, a `notify on finish` toggle (asking
  for permission on enable, and explaining how to recover when the browser has
  blocked it), the voice disclosure, and the device public key
- **Light, dark and system themes** — every surface paints from `--pi-*` tokens
  declared once with CSS `light-dark()`, so `system` follows the OS with no JS
  watcher and an explicit choice just pins `data-theme` on `<html>`. The tokyo-night
  (dark) and github-light (light) Shiki themes follow the resolved theme
- **Interactive prompts** (`extension_ui_request`): single choice, multi-select,
  preview panes, free-text answers and cancel. Answered through the pi-ask
  `ask` envelope with option **values** when the prompt carries one, and with a
  bare label when it does not — see `lib/session/answers.ts`. The same frame
  family also carries four one-way display controls — `setStatus` (status line),
  `setWidget` (bordered widget blocks), `setTitle` (window title) and
  `set_editor_text` (composer draft). These mutate ephemeral session UI state,
  never the transcript; the reducer lives in `lib/session/ui_control.ts` and the
  chrome renders from `components/pi/UiChrome.tsx`
- PWA: installable, with the manifest and service worker generated by
  `vite-plugin-pwa`/Workbox at build time (no hand-written `sw.js`). The worker
  precaches the shell (HTML is prerendered), serves navigations network-first
  with a cached fallback for offline reloads, and caches the immutable
  `/_next/static/*` chunks cache-first. `public/_headers` keeps `sw.js` and
  `manifest.webmanifest` revalidating so updates land promptly
- **Session notifications** — an OS notification when a turn finishes, the Pi
  asks a question (`ask_user`) or the session errors. Scoped to the **session
  page** on purpose: they exist to tell you *this* session needs you, so leaving
  the page releases the badge and the unread title. They are raised only while the
  tab is hidden, because a visible tab already shows the result. Unread activity
  also prefixes the tab title (`(2) Remote Pi`) and the installed-app badge where
  the platform exposes it. Toggle and permission live in Settings; no push server
  is involved, so it works for a background tab, not a closed browser
- **PWA update notice** — with `registerType: "autoUpdate"` a new worker activates
  silently, which leaves the open page running the previous build's chunks. The
  client watches `controllerchange` and offers a reload rather than forcing one:
  reloading mid-turn would drop the transcript, so the banner says when a turn is
  running and the user picks the moment. `registration.update()` is nudged
  whenever the tab becomes visible, so an installed PWA notices a deploy
- **Mobile-friendly chrome** — dialogs size to `calc(100% - 2rem)` with a
  viewport-height cap so they never overflow a phone, the actions palette
  anchors to the top edge so the on-screen keyboard cannot cover it, the status
  rail folds settings/resync/reconnect into a single `menu` dropdown, and the
  composer offers a clickable `interrupt` (not just the Esc hint) while a turn
  runs

## What is not

- **pi-ask `elaborate` mode** — answers are submitted with `mode: "submit"`;
  the elaborate flow is not exposed.
- **Offline sending** — a message sent while disconnected is refused with a
  notice rather than queued.
- **End-to-end encryption** — none exists in the protocol; the relay sees
  plaintext (see `../PROTOCOL.md` § Trust Model).

## Security notes

- The relay sees message content. Run your own relay for sensitive work.
- The identity is not hardware-backed (IndexedDB, not Keychain).
- "Forget" removes the pairing from this browser only; the Pi keeps its record
  until you revoke it there.
- Images are re-encoded through a canvas before sending, which strips EXIF as a
  side effect — but the image itself leaves the device in the clear, like every
  other payload.

## Verification

`pnpm test` runs 216 offline tests (codec, transcript reducer and message
lifecycle, notification decisions, home-screen filtering and presence, answer
construction, markdown rendering, the voice controller against a mocked
`SpeechRecognition`, static renders, and the relay client against a fake
WebSocket that reproduces the browser's `send()`-while-CONNECTING semantics).

`PI_LIVE=1 pnpm test` adds one integration test over the real relay that pairs,
mirrors the session, subscribes to rooms, and then drives `list_models`,
`model_set`, `thinking_set`, `session_compact`, `session_new`, the draft queue,
steering and a rich prompt answer — asserting on the peer's own record of what
it received.

## Credits

- [`cloudflare/vinext`](https://github.com/cloudflare/vinext) — build and deploy
- [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app) +
  [Workbox](https://developer.chrome.com/docs/workbox) — generates the web app
  manifest and service worker (`generateSW`), configured in `vite.config.ts`
- [Streamdown](https://streamdown.ai) (`streamdown` + `@streamdown/code`) —
  streaming-safe agent markdown and Shiki-highlighted, copyable code blocks
- [shadcn/ui](https://ui.shadcn.com) primitives, vendored into `components/ui/`:
  `Dialog` on [Radix UI](https://www.radix-ui.com) and `Command` on
  [cmdk](https://cmdk.paco.me), with the neutral tokens remapped to the terminal
  palette in `app/globals.css`. Icons via
  [lucide](https://lucide.dev)
- [`cn`](https://github.com/shadcn-ui/cn) — Tailwind class merging behind
  `lib/utils.ts` (`cn`), the drop-in `clsx` + `tailwind-merge` replacement
- [brainless](https://brainless.swerdlow.dev/components) — the terminal UI
  components in `components/brainless/`, vendored verbatim from the registry:

  | Component | Used for |
  |---|---|
  | `claude-message` | user prompt row (`❯`) and assistant text |
  | `claude-tool-call` | `⏺ Tool(arg)` / `⎿ result` disclosure |
  | `claude-diff` | unified-diff tool results |
  | `claude-thinking` | in-flight turn indicator |
  | `claude-permission` | the interactive prompt box's visual grammar |
  | `codex-prompt` | composer (`›` + model · directory) |
  | `grok-event` | `◆` event lines (compaction) |

  Hand-written in the same visual grammar, because the registry components for
  these slots hard-code another product's labels or embed a demo composer:
  the pair screen's welcome box, the paired-Pi picker, the quick-actions panel,
  the prompt renderer (`QuestionPrompt` — a real radiogroup/checkbox group with
  previews and free text), and the `◆` error line.

  `lib/utils.ts` (`cn`) exists because the registry components import it; it now
  re-exports `cn` from the [`cn`](https://github.com/shadcn-ui/cn) package (the
  drop-in `clsx` + `tailwind-merge` replacement) instead of hand-rolling it.

- `branding/logo-full.svg` — the app icon (`public/icon.svg`, PNGs derived with
  ImageMagick).

## Development harness

`tools/fake-pi-peer.mjs` is a minimal fake Pi peer that speaks the protocol and
serves a synthetic session (tool calls, a diff, a failed tool, a streamed turn,
an interactive prompt). It answers every typed action, the draft queue, steering
and prompt responses. It exists so the client can be exercised without a real pi
session — and so the integration test can drive it in-process and assert on what
actually arrived.

```bash
node tools/fake-pi.mjs      # prints a remotepi:// link to paste
ASK=0 node tools/fake-pi.mjs
RELAY=ws://localhost:3000 node tools/fake-pi.mjs
```

It is a development tool, not product code: it accepts any pairing token and
uses the public relay by default.
