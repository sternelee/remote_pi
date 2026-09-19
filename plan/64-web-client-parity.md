# 64 — Web client parity: markdown, lifecycle, voice, settings

> **Status**: APPROVED (2026-09-20). Design for the second feature pass on `web/`,
> bringing it level with the Flutter app (`app/`) without leaving the brainless
> terminal UI/UX. Builds on plan/63 (which established pairing, the session
> mirror, the transcript, steering, the draft queue, attachments and prompts).

## Context

`web/` already covers the protocol end-to-end: identity, pairing, relay
handshake, room discovery, session mirror, transcript (user/agent/tool/diff/
compaction/error/bye/prompt), composer with steering, one image per message,
quick actions (compact/new/model/thinking), the draft queue and interactive
prompts. See plan/63 and `web/README.md` § "What is implemented".

The Flutter app has a set of everyday features the web client lacks. This plan
adds six of them, chosen by the user, all rendered in the existing
`components/brainless/**` terminal grammar. No new routes: every new surface is a
panel opened from the status rail or the composer, keeping the single-screen UX.

## Scope

| # | Feature | App reference |
|---|---|---|
| 1 | Markdown + per-code-block copy + links | `app/lib/ui/chat/widgets/agent_markdown.dart` |
| 2 | Message lifecycle (pending/failed/steering) + received images | `app/lib/ui/chat/widgets/message_bubble.dart`, `image_bubble.dart` |
| 3 | Session info dialog + new-session confirm | `app/lib/ui/chat/chat_page.dart` info dialog, quick_actions sheet |
| 4 | Model picker provider filter + vision gating on attach | `model_picker_sheet.dart`, `attachment_viewmodel.dart` |
| 5 | Voice input (Web Speech API) | `app/lib/ui/chat/voice/**`, `input_bar.dart` |
| 6 | Editable draft queue + settings/preferences panel | `input_bar.dart` queue preview, `preferences.dart` |

Explicitly out of scope (already declared in `web/README.md` § "What is not"):
pi-ask `elaborate` mode, offline send queueing, end-to-end encryption.

## Cross-cutting

### Preferences

Extend `Settings` in `web/lib/storage/store.ts`:

```ts
export interface Settings {
  relay_url?: string;
  last_peer_epk?: string;
  /** Hide `tool`/`diff` timeline entries in the transcript. */
  hide_tool_calls?: boolean;
  /** Set once the voice privacy disclosure has been shown. */
  voice_notice_ack?: boolean;
}
```

`usePiSession` already loads settings during boot; it gains `prefs` and
`setPrefs(partial)` exposed on `PiSession`. Persistence stays in the existing
IndexedDB settings store — no new mechanism.

### Room meta

`handleControl` currently keeps `model` and `thinking`. Extend it to also keep
`cwd` (and `name`) from `room_announced`/`room_meta_updated`/`rooms`, exposed as
`room?: RoomInfo`, for feature 3.

## 1. Markdown + code copy (Streamdown)

- Add dependencies `streamdown` (v2, Apache-2.0, drop-in react-markdown
  replacement by Vercel) and `@streamdown/code` (Shiki syntax highlighting).
- Wire Tailwind: add `@source "../node_modules/streamdown/dist/*.js"` and
  `@source "../node_modules/@streamdown/code/dist/*.js"` to `app/globals.css`,
  and `import "streamdown/styles.css"`.
- New `web/components/pi/Markdown.tsx` wraps the `Streamdown` component:
  - `plugins={{ code }}` from `@streamdown/code` for syntax highlighting.
  - `shikiTheme={["tokyo-night", "tokyo-night"]}` (dark-only).
  - `controls={{ code: { copy: true, download: false } }}` — copy button per
    block, no download (matches the app's copy-only affordance).
  - `mode={streaming ? "streaming" : "static"}` and `isAnimating={streaming}`.
  - `parseIncompleteMarkdown` left on (remend) so partial markdown renders
    cleanly while streaming — this replaces the earlier "plain text until the
    turn ends" compromise.
  - Custom `components` overrides to keep the mono tokyo-night palette
    (`a` → `#7dcfff`, headings/lists/blockquote/table in FG/DIM).
  - `linkSafety` left at its default (enabled): the full-URL confirmation modal
    before navigating, kept as a safety net for model output.
- Safety: Streamdown's default `rehype-sanitize`/`rehype-harden` keep raw HTML
  escaped, so the existing "escapes agent output" test keeps passing. No
  `skipHtml`.
- Used for `agent` entries in `Transcript.tsx`.

## 2. Message lifecycle + received images

- `TimelineEntry` user gains `status?: "pending" | "confirmed" | "failed"` and
  `sentAt?: number`.
- `addLocalUserMessage` marks `pending` with `sentAt = Date.now()`; the
  `user_message`/`user_input` echo flips it to `confirmed` in the existing
  upsert branch of `applyMessage`.
- New pure helper `markUserFailed(state, id)`; `usePiSession` runs a 20s reaper
  (the app's silent-reap window) that fails any still-pending local send.
- `Transcript.tsx` user row suffixes: `· sending…` (dim), `· not delivered`
  (red), plus the existing `· steering…` / `· steered`.
- Received images: render `entry.images` as thumbnails in the user bubble; a
  click opens the data URL in a new tab. No custom lightbox (the app has none).

## 3. Session info + new-session confirm

- New `components/pi/SessionInfo.tsx`, opened by an `info` link on the status
  rail: Name, Host, Path (cwd), Room, Model, Thinking, Relay, Paired-at, Owner
  (Pi pubkey, truncated).
- `QuickActions` "New session" row swaps into an inline confirm row
  (`clear the Pi-side conversation? [confirm] [cancel]`) before emitting
  `session_new`. The existing post-`action_ok` mirror re-pull is unchanged.

## 4. Model picker filter + vision gating

- `QuickActions`: provider filter chips derived from the `models` catalogue;
  `refresh` preserves the selected provider. The list filters on the selection.
- Pass `currentModel` down to `Composer`; `attach image` is disabled when
  `currentModel && !currentModel.vision`, with a `title` explaining why.

## 5. Voice input (Web Speech API)

- New `components/pi/voice/useVoiceInput.ts` (or `lib/session/voice.ts`): wraps
  `SpeechRecognition ?? webkitSpeechRecognition`, `interimResults = true`,
  `lang = navigator.language`, single-shot, 60s client cap. Exposes
  `supported | listening | interim | error | start | stop | cancel`.
- `Composer` footer gains a `mic` link, shown only when `supported`.
  **Decision:** click-to-toggle, not press-and-hold — hold gestures are
  unreliable with a mouse and on mobile. `stop` drops the final transcript into
  the draft for review (never auto-sent); `cancel` discards.
- First use shows the disclosure ("Voice uses your browser's speech service —
  audio may leave this device"), acked via `voice_notice_ack`. The settings
  panel repeats it.

## 6. Editable draft queue + settings panel

- `Composer` queued strip becomes a button: click pulls the text into the draft
  and clears the Pi queue (`queued_message_set` with an empty `text`). The Pi
  echoes `queued_message_state`, so the local list is never hand-maintained.
- New `components/pi/SettingsPanel.tsx`, opened by a `settings` link on the
  status rail: relay URL (input + save, reusing `isValidRelayUrl`; a save
  reconnects via the existing `setRelayUrl`), `hide tool calls` toggle, voice
  disclosure, read-only truncated device pubkey.
- `hide_tool_calls` filters `tool` and `diff` entries in `Transcript`.

## Files

New:

```
web/components/pi/Markdown.tsx
web/components/pi/SettingsPanel.tsx
web/components/pi/SessionInfo.tsx
web/components/pi/voice.ts (or lib/session/voice.ts)
web/test/markdown.test.tsx
web/test/voice.test.ts
```

Changed: `web/lib/storage/store.ts`, `web/lib/session/transcript.ts`,
`web/lib/session/usePiSession.ts`, `web/components/pi/{SessionScreen,Composer,
QuickActions,Transcript}.tsx`, `web/package.json`, `web/README.md`.

## Verification

- `pnpm typecheck` clean.
- `pnpm test`: new tests for markdown render (code-copy button, safe links, raw
  HTML stays escaped), lifecycle statuses + reaper, image thumbnails,
  hide-tool-calls filter, the voice hook against a mocked `SpeechRecognition`,
  and settings persistence. Existing grammar/render tests stay green.
- `pnpm build` succeeds with the new dependency.

## Increment order

1. Preferences store (cross-cutting)
2. Markdown + code copy
3. Message lifecycle + received images
4. Session info + new-session confirm
5. Model filter + vision gating
6. Editable queue + settings panel
7. Voice input (last: most browser-dependent)

## Implementation plan

TDD throughout: write the failing test, run it red, implement, run green. Run
`pnpm test` from `web/` after each task; `pnpm typecheck` before each commit.
Do not commit unless asked.

### Task 0 — Preferences store (cross-cutting)

Files: `lib/storage/store.ts`, `lib/session/usePiSession.ts`.
- Extend `Settings` with `hide_tool_calls?`, `voice_notice_ack?`.
- `usePiSession` boots prefs from `loadSettings()`, exposes
  `prefs: { hideToolCalls; voiceNoticeAck }` and
  `setPrefs(patch: Partial<{hideToolCalls;voiceNoticeAck}>)` (persists + state).
- Test: reducer/helper-level only (IndexedDB is absent under Node).

### Task 1 — Markdown + code copy

Files: `package.json`, `app/globals.css`, new `components/pi/Markdown.tsx`,
`components/pi/Transcript.tsx`, new `test/markdown.test.tsx`.
- `pnpm add streamdown @streamdown/code`.
- `globals.css`: add the two `@source` lines + `@import "streamdown/styles.css"`.
- `Markdown.tsx` as specified above (`plugins={{code}}`, tokyo-night theme,
  copy-only control, streaming props, `components` overrides).
- `Transcript.tsx` agent branch renders `<Markdown streaming={entry.streaming}>`.
- Test: static render asserts rendered text survives, `&lt;`/raw HTML stays
  escaped, and links carry `#7dcfff` + `rel`. Update the existing agent
  assertions in `test/transcript-render.test.tsx` if the wrapper changed.

### Task 2 — Message lifecycle + received images

Files: `lib/session/transcript.ts`, `lib/session/usePiSession.ts`,
`components/pi/Transcript.tsx`, `test/transcript.test.ts`,
`test/transcript-render.test.tsx`.
- Add `status`/`sentAt` to the user entry; `addLocalUserMessage` marks pending;
  echo upsert marks confirmed; add pure `failStalePending(state, now, ms)`.
- `usePiSession` reaper interval (20s) while a peer is active.
- Render `· sending…` / `· not delivered`; render `entry.images` thumbnails
  (click opens the data URL in a new tab) instead of `[N image]`.
- Tests: pending→confirmed on echo; `failStalePending` marks only stale; image
  thumbnail markup present.

### Task 3 — Session info + new-session confirm

Files: `lib/session/usePiSession.ts`, new `components/pi/SessionInfo.tsx`,
`components/pi/SessionScreen.tsx`, `components/pi/QuickActions.tsx`.
- Capture `cwd` from room control frames; expose `cwd` on `PiSession`.
- `SessionInfo` panel opened from the status rail (Name/Host/Path/Room/Model/
  Thinking/Relay/Paired/Owner).
- `QuickActions` "New session" swaps to an inline confirm row before emitting.

### Task 4 — Model filter + vision gating

Files: `components/pi/QuickActions.tsx`, `components/pi/Composer.tsx`,
`components/pi/SessionScreen.tsx`.
- Provider chips derived from `models`; filter the list; refresh keeps filter.
- `Composer` gains `canAttach`; disable `attach image` when the current model
  has no vision.

### Task 5 — Editable queue + settings panel

Files: `components/pi/Composer.tsx`, new `components/pi/SettingsPanel.tsx`,
`components/pi/SessionScreen.tsx`, `components/pi/Transcript.tsx`.
- Queued strip becomes a button that pulls text into the draft and clears queue.
- `SettingsPanel` from the status rail (relay URL, hide tool calls, voice
  disclosure, device pubkey).
- `Transcript` gains `hideToolCalls` and filters `tool`/`diff` entries.

### Task 6 — Voice input

Files: new `lib/session/voice.ts`, `components/pi/Composer.tsx`,
`components/pi/SessionScreen.tsx`, new `test/voice.test.ts`.
- Hook around `SpeechRecognition`; click-to-toggle; 60s cap; transcript into the
  draft; disclosure notice acked via `voice_notice_ack`.
- Test the hook against a mocked `SpeechRecognition` (start/stop/result/error).
