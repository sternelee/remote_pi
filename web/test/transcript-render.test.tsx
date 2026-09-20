/**
 * Render tests: protocol fixtures → the actual terminal grammar.
 *
 * These assert on the real markup produced by the vendored brainless
 * components, so a change to the transcript mapping that silently drops the
 * ⏺ / ⎿ / ❯ glyphs (the whole point of the visual grammar) fails here.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Transcript } from "../components/pi/Transcript";
import {
  addLocalUserMessage,
  applyMessage,
  emptyTranscript,
  failStalePending,
  timelineFromHistory,
} from "../lib/session/transcript";
import type { ServerMessage } from "../lib/protocol/types";
import { fixture, readFixture } from "./fixtures";

const noop = () => {};

function render(messages: ServerMessage[]): string {
  const state = messages.reduce(applyMessage, emptyTranscript);
  return renderToStaticMarkup(<Transcript state={state} onAnswer={noop} />);
}

describe("transcript rendering", () => {
  it("renders a user turn with the Claude Code prompt row", () => {
    const html = render([fixture<ServerMessage>("user_input")]);
    expect(html).toContain("❯");
    expect(html).toContain("listar arquivos modificados");
    // The full-width prompt row is the visual signature of a user turn.
    expect(html).toContain("background:var(--pi-user-bg)");
  });

  it("renders a tool call as a real disclosure with the ⏺/⎿ grammar", () => {
    const html = render([
      { type: "tool_request", tool_call_id: "tc_1", tool: "Bash", args: { command: "git status -s" } },
      { type: "tool_result", tool_call_id: "tc_1", result: " M src/index.ts" },
    ]);
    expect(html).toContain("<details");
    expect(html).toContain("⏺");
    expect(html).toContain("⎿");
    expect(html).toContain("Bash");
    expect(html).toContain("git status -s");
    // Result text is behind the disclosure, not printed on the summary line.
    expect(html).toContain(" M src/index.ts");
  });

  it("renders an error tool result with the red status colour", () => {
    const html = render([
      { type: "tool_request", tool_call_id: "tc_9", tool: "Bash", args: { command: "sleep 99" } },
      { type: "tool_result", tool_call_id: "tc_9", error: "command timed out after 60s" },
    ]);
    expect(html).toContain("var(--pi-red)");
    expect(html).toContain("command timed out after 60s");
  });

  it("renders a unified-diff result as a diff block with tinted rows", () => {
    const diff = ["@@ -1,2 +1,3 @@", " keep", "-gone", "+added"].join("\n");
    const html = render([
      { type: "tool_request", tool_call_id: "tc_d", tool: "Edit", args: { file_path: "lib/a.ts" } },
      { type: "tool_result", tool_call_id: "tc_d", result: diff },
    ]);
    expect(html).toContain("lib/a.ts");
    expect(html).toContain("additions");
    expect(html).toContain("rgba(78, 169, 111,.10)"); // added-row tint
  });

  it("renders an interactive prompt as a real radiogroup", () => {
    const html = render([
      {
        type: "extension_ui_request",
        id: "q1",
        method: "select",
        title: "Which environment?",
        options: ["staging", "prod"],
      },
    ]);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("Which environment?");
    expect(html).toContain("prod");
  });

  it("replaces an answered prompt with a resolved line", () => {
    const state = applyMessage(emptyTranscript, {
      type: "extension_ui_request",
      id: "q2",
      method: "confirm",
      title: "Deploy?",
      message: "Touches prod.",
    });
    const html = renderToStaticMarkup(
      <Transcript state={{ ...state, entries: state.entries.map((e) => (e.kind === "question" ? { ...e, answered: "Yes" } : e)) }} onAnswer={noop} />,
    );
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain("answered · Yes");
  });

  it("renders the running indicator only while a turn is in flight", () => {
    const idle = render([{ type: "agent_chunk", in_reply_to: "t", delta: "hi" }, { type: "agent_done", in_reply_to: "t" }]);
    expect(idle).not.toContain('aria-live="polite"');

    const running = render([{ type: "agent_chunk", in_reply_to: "t", delta: "hi" }]);
    expect(running).toContain('aria-live="polite"');
  });

  it("renders the full session_history fixture without throwing", () => {
    const html = render([fixture<Extract<ServerMessage, { type: "session_history" }>>("session_history")]);
    expect(html).toContain("❯");
    expect(html).toContain("⏺");
    // The consolidated agent reply from the mirror.
    expect(html).toContain("2 arquivos modificados");
  });

  it("renders every error fixture line as a red event", () => {
    const html = render(readFixture("error") as ServerMessage[]);
    expect(html.match(/var\(--pi-red\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("tool_approval_required");
    expect(html).toContain("too_large");
  });

  it("renders compaction as a ◆ event line", () => {
    const html = render([{ type: "compaction", summary: "condensed 40 turns", tokens_before: 92000 }]);
    expect(html).toContain("◆");
    expect(html).toContain("context compacted");
    expect(html).toContain("condensed 40 turns");
  });

  it("shows usage on a finished turn", () => {
    const html = render([fixture<Extract<ServerMessage, { type: "agent_message" }>>("agent_message")]);
    expect(html).toContain("120 in");
    expect(html).toContain("340 out");
  });

  it("neutralizes agent output instead of injecting markup", () => {
    const html = render([
      { type: "agent_chunk", in_reply_to: "x", delta: "<img src=x onerror=alert(1)>" },
      { type: "agent_done", in_reply_to: "x" },
    ]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("renders reasoning as a collapsed thinking disclosure", () => {
    const html = render([
      { type: "agent_thinking_chunk", in_reply_to: "t", delta: "weighing the options" },
      { type: "agent_done", in_reply_to: "t" },
    ]);
    expect(html).toContain("<details");
    expect(html).toContain("thinking");
    expect(html).toContain("weighing the options");
    expect(html).not.toContain("thinking…");
  });

  it("marks reasoning as in progress while the turn streams", () => {
    const html = render([{ type: "agent_thinking_chunk", in_reply_to: "t", delta: "hmm" }]);
    expect(html).toContain("thinking…");
  });

  it("timelineFromHistory produces a renderable state", () => {
    const history = fixture<Extract<ServerMessage, { type: "session_history" }>>("session_history");
    const html = renderToStaticMarkup(
      <Transcript state={timelineFromHistory(history)} onAnswer={noop} />,
    );
    expect(html.length).toBeGreaterThan(100);
  });
});

describe("message delivery states", () => {
  it("labels an unacknowledged send as sending…", () => {
    const state = addLocalUserMessage(emptyTranscript, "u1", "hello");
    const html = renderToStaticMarkup(<Transcript state={state} onAnswer={noop} />);
    expect(html).toContain("· sending…");
  });

  it("drops the label once the Pi echoes the message", () => {
    const pending = addLocalUserMessage(emptyTranscript, "u1", "hello");
    const confirmed = applyMessage(pending, { type: "user_message", id: "u1", text: "hello" });
    const html = renderToStaticMarkup(<Transcript state={confirmed} onAnswer={noop} />);
    expect(html).not.toContain("sending…");
    expect(html).not.toContain("not delivered");
  });

  it("labels a reaped message as not delivered in red", () => {
    const pending = addLocalUserMessage(emptyTranscript, "u1", "hello", { now: 1000 });
    const html = renderToStaticMarkup(
      <Transcript state={failStalePending(pending, 60_000, 20_000)} onAnswer={noop} />,
    );
    expect(html).toContain("· not delivered");
    expect(html).toContain("var(--pi-red)");
  });

  it("renders received images as openable thumbnails", () => {
    const html = render([
      {
        type: "user_message",
        id: "with-image",
        text: "look",
        images: [{ data: "AAAA", mime: "image/jpeg" }],
      },
    ]);
    expect(html).toContain("<img");
    expect(html).toContain("data:image/jpeg;base64,AAAA");
    expect(html).toContain('target="_blank"');
  });
});
