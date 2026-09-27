# 68 — Web client: pi-ask notes + the elaborate exit

> **Status**: IMPLEMENTADO (2026-09-27). Brings the second pi-ask exit to `web/`.
> Plan/57 put `mode: "submit" | "elaborate"` and the note fields on the wire, but
> every client pinned `submit` and no UI exposed notes. This pass makes the full
> flow usable from the browser. Builds on plan/63 and plan/64.

## Context

The `ask` envelope always carried `mode` and `AskAnswerWire.note`/`optionNotes`
(`web/lib/protocol/types.ts`), the bridge forwards `ask.mode` verbatim
(`pi-extension/src/extension_ui_bridge.ts`), and the upstream pi-ask contract
defines elaborate as note-driven: the user asks the agent to clarify the
attached notes before finalizing choices; pi-ask then moves note-only entries
into `elaboration.items` and hands the model `elaboration`/`continuation`
details instead of a resolution. Nothing on the web client could produce any of
it — answers were always submitted with `mode: "submit"`.

## What shipped

| Layer | Change |
|---|---|
| `web/lib/protocol/types.ts` | exported `AskAnswerMode`; the response envelope references it (single source of truth) |
| `web/lib/session/answers.ts` | `Selection` gains `notes`/`optionNotes`; `buildQuestionAnswer` takes the mode and emits `note`/`optionNotes`; new `answerToWire()` — cancel/rich/degraded frames in one testable place (the hook used to hard-code `mode: "submit"`) |
| `web/lib/session/usePiSession.ts` | sends via `answerToWire`; `QuestionAnswer.mode`; the resolved transcript entry records the exit used |
| `web/components/pi/QuestionPrompt.tsx` | review-then-exit UX: selection never auto-submits; action bar `submit` / `elaborate` / `esc cancel`; question- and option-level note editors (collapsed until asked for); `elaborate` disabled until a note exists; notes and the second exit render only on `ask` flows |
| `web/components/pi/Transcript.tsx` | resolved line distinguishes "answered" / "asked to elaborate" / "cancelled" |

## Decisions (registered)

1. **A note counts as an answer.** pi-ask keeps note-only entries so the model
   reads them; a question answered only by a note satisfies `required` on
   `submit`.
2. **A blank required question does not block `elaborate`.** Asking about a
   question you cannot answer yet is the point of the exit; blank questions are
   omitted and pi-ask marks them `needs_clarification`/`unanswered` in its
   result. `required` still blocks `submit`.
3. **A note-less `elaborate` is refused client-side** (`buildQuestionAnswer`
   returns `null`). pi-ask builds `elaboration.items` from the notes, so an
   empty elaborate is a dead-end round trip that would also replace the user's
   submit. Client guard, not a wire rule.

## Upstream constraints

- The pi-ask remote-events contract (`started`/`submit`/`submit-result`/
  `completed`) does **not** expose `continuation`/`elaboration`. A refined
  re-ask reaches a remote client as a brand-new flow with no memory of
  already-committed answers.
- `recommended` (option-level presentation metadata) and
  `presentedType`/`requestedType` are still not rendered remotely: the bridge's
  `parseOption` drops the former and the web `QuestionView` drops the latter.

## Verification

`pnpm test` — 256 offline tests (answer construction incl. notes/mode, wire
frame shapes, static renders incl. the elaborate resolved line);
`tsc --noEmit` clean. The `PI_LIVE=1` integration test does not yet drive an
elaborate round trip.

## Remaining

- Drive an elaborate round trip in `test/live-actions.test.ts` (`PI_LIVE=1`).
- Surface `recommended` + `presentedType` (bridge `parseOption` and web
  `QuestionView` must change together).
- App parity: `app/lib/ui/chat/widgets/extension_ui_sheet.dart` still pins
  `mode: 'submit'`.
