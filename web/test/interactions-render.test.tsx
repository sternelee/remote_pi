/**
 * Render tests for the interaction surfaces added after the first pass:
 * the richer prompt renderer (multi/preview/freeform/cancel) and the quick
 * actions panel. Assertions are on the real markup, so losing the terminal
 * grammar or a control's semantics fails here.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Command } from "../components/ui/command";
import { Composer, commandQueryFor, filterCommands } from "../components/pi/Composer";
import {
  QuickActions,
  NewSessionConfirm,
  ThinkingPage,
  ModelPage,
  filterModelsByProvider,
  modelProviders,
} from "../components/pi/QuickActions";
import { QuestionPrompt } from "../components/pi/QuestionPrompt";
import { SessionInfo } from "../components/pi/SessionInfo";
import { SessionMenu } from "../components/pi/SessionMenu";
import { SettingsPanel } from "../components/pi/SettingsPanel";
import { Transcript } from "../components/pi/Transcript";
import { SessionTitle, StatusList, WidgetList } from "../components/pi/UiChrome";
import type { WireCommand, WireModel } from "../lib/protocol/types";
import { addLocalUserMessage, applyMessage, emptyTranscript, questionsOf } from "../lib/session/transcript";
import type { ServerMessage } from "../lib/protocol/types";

const noop = () => {};

describe("composer command picker", () => {
  const commands: WireCommand[] = [
    { name: "remote-pi", description: "Manage the remote connection", source: "extension" },
    { name: "plan", source: "prompt" },
    { name: "skill:git", source: "skill" },
  ];

  it("derives the query only from a bare slash draft", () => {
    expect(commandQueryFor("/")).toBe("");
    expect(commandQueryFor("/plan")).toBe("plan");
    expect(commandQueryFor("/PLAN")).toBe("plan");
    expect(commandQueryFor("/plan extra")).toBeNull();
    expect(commandQueryFor("hello")).toBeNull();
  });

  it("filters commands by name and stays closed without a query", () => {
    expect(filterCommands(commands, null)).toEqual([]);
    expect(filterCommands(commands, "plan")).toEqual([commands[1]]);
    expect(filterCommands(commands, "pi")).toEqual([commands[0]]);
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });
});

const MULTI_PROMPT = {
  type: "extension_ui_request",
  id: "req-multi",
  method: "select",
  title: "degraded",
  options: ["x"],
  ask: {
    flow_id: "flow-multi",
    tool_call_id: null,
    source: "tool",
    title: "Which databases?",
    questions: [
      {
        id: "db",
        label: "Databases",
        prompt: "Pick any to inspect",
        type: "multi" as const,
        required: true,
        options: [
          { value: "pg", label: "Postgres", description: "primary" },
          { value: "my", label: "MySQL" },
        ],
      },
    ],
  },
} satisfies Extract<ServerMessage, { type: "extension_ui_request" }>;

const PREVIEW_PROMPT = {
  type: "extension_ui_request",
  id: "req-preview",
  method: "select",
  title: "degraded",
  options: ["x"],
  ask: {
    flow_id: "flow-preview",
    tool_call_id: null,
    source: "tool",
    title: "Pick a layout",
    questions: [
      {
        id: "layout",
        label: "Layout",
        prompt: "Choose a variant",
        type: "preview" as const,
        required: true,
        options: [
          { value: "a", label: "Stacked", preview: "<div>stacked</div>" },
          { value: "b", label: "Split", preview: "<div>split</div>" },
        ],
      },
    ],
  },
} satisfies Extract<ServerMessage, { type: "extension_ui_request" }>;

function renderPrompt(message: Extract<ServerMessage, { type: "extension_ui_request" }>): string {
  const { method, title, body, questions } = questionsOf(message);
  return renderToStaticMarkup(
    <QuestionPrompt
      requestId={message.id}
      flowId={"ask" in message ? message.ask?.flow_id : undefined}
      title={title}
      body={body}
      questions={questions}
      onAnswer={noop}
    />,
  );
}

describe("prompt rendering", () => {
  it("renders a multi-select question as checkboxes with a submit affordance", () => {
    const html = renderPrompt(MULTI_PROMPT);
    expect(html).toContain('role="group"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("(choose any)");
    expect(html).toContain("submit");
    expect(html).toContain("Postgres");
    expect(html).toContain("primary");
    // Not a radiogroup — multi-select must not claim single-choice semantics.
    expect(html).not.toContain('role="radiogroup"');
  });

  it("renders a single-choice question as a radiogroup with the ❯ grammar", () => {
    const html = renderPrompt({
      type: "extension_ui_request",
      id: "req-single",
      method: "select",
      title: "Which environment?",
      options: ["staging", "prod"],
    });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("❯");
    expect(html).toContain("Which environment?");
  });

  it("renders a preview question with a preview pane", () => {
    const html = renderPrompt(PREVIEW_PROMPT);
    expect(html).toContain("<pre");
    expect(html).toContain("Stacked");
    expect(html).toContain("Split");
    // The preview body is escaped, never injected as markup.
    expect(html).not.toContain("<div>stacked</div>");
  });

  it("renders a free-text answer input for input/editor prompts", () => {
    const html = renderPrompt({
      type: "extension_ui_request",
      id: "req-input",
      method: "input",
      title: "Branch name",
      placeholder: "feature/…",
    });
    expect(html).toContain('type="text"');
    expect(html).toContain("feature/…");
  });

  it("always offers a cancel that reaches pi-ask", () => {
    const html = renderPrompt(MULTI_PROMPT);
    expect(html).toContain("esc cancel");
  });

  it("shows keyboard hints", () => {
    expect(renderPrompt(MULTI_PROMPT)).toContain("↑↓ choose");
  });
});

describe("steering in the transcript", () => {
  it("marks a steering message and then a steered one", () => {
    const id = "018f9c2a-7b1e-7000-9a3b-1c2d3e4f5a6e";
    const steering = addLocalUserMessage(emptyTranscript, id, "also do X", { steering: true });
    const html = renderToStaticMarkup(<Transcript state={steering} onAnswer={noop} />);
    expect(html).toContain("steering…");

    const consumed = applyMessage(steering, { type: "steer_consumed", id });
    const after = renderToStaticMarkup(<Transcript state={consumed} onAnswer={noop} />);
    expect(after).toContain("steered");
    expect(after).not.toContain("steering…");
  });

  it("does not mark a plain message as steering", () => {
    const html = renderToStaticMarkup(
      <Transcript state={addLocalUserMessage(emptyTranscript, "x", "hello")} onAnswer={noop} />,
    );
    expect(html).not.toContain("steering");
  });

  it("renders attached images as thumbnails on the user turn", () => {
    const state = addLocalUserMessage(emptyTranscript, "y", "look", {
      images: [{ data: "AAAA", mime: "image/jpeg" }],
    });
    const html = renderToStaticMarkup(<Transcript state={state} onAnswer={noop} />);
    expect(html).toContain("data:image/jpeg;base64,AAAA");
    expect(html).toContain("<img");
  });
});

describe("quick actions panel", () => {
  const model = (id: string, name: string, extra: Partial<WireModel> = {}): WireModel => ({
    id,
    name,
    provider: "anthropic",
    reasoning: true,
    context_window: 200_000,
    vision: true,
    ...extra,
  });

  const base = {
    open: true,
    onOpenChange: noop,
    onCompact: noop,
    onNewSession: noop,
    onListModels: noop,
    onPickModel: noop,
    onPickThinking: noop,
  };

  // The page bodies live inside a cmdk `Command`, so tests that render a page
  // directly must supply that context.
  const renderPage = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(<Command>{node}</Command>);

  it("offers both session actions with their consequences spelled out", () => {
    const html = renderToStaticMarkup(<QuickActions {...base} models={[]} />);
    expect(html).toContain("Compact context");
    expect(html).toContain("summarize old turns");
    expect(html).toContain("New session");
    expect(html).toContain("clears the Pi-side conversation");
  });

  it("links out to the thinking and model pages", () => {
    const html = renderToStaticMarkup(
      <QuickActions {...base} models={[]} modelName="Claude Opus 4.8" thinking="high" />,
    );
    expect(html).toContain("Thinking");
    expect(html).toContain("high");
    expect(html).toContain("Model");
    expect(html).toContain("Claude Opus 4.8");
  });

  it("anchors the palette to the top so the keyboard cannot cover it", () => {
    const html = renderToStaticMarkup(<QuickActions {...base} models={[]} />);
    expect(html).toContain('data-position="top"');
    expect(html).toContain("top-0");
    expect(html).not.toContain("top-[50%]");
  });

  it("renders the six thinking levels with the current one marked", () => {
    const html = renderPage(
      <ThinkingPage
        currentModel={model("opus", "Opus")}
        thinking="high"
        busy={false}
        onBack={noop}
        onPick={noop}
      />,
    );
    for (const label of ["off", "min", "low", "med", "high", "x"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("❯ ");
  });

  it("disables thinking levels for a non-reasoning model", () => {
    const html = renderPage(
      <ThinkingPage
        currentModel={model("haiku", "Haiku", { reasoning: false })}
        thinking="off"
        busy={false}
        onBack={noop}
        onPick={noop}
      />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("unavailable for this model");
  });

  it("lists the catalogue with provider and capability hints", () => {
    const models = [
      model("opus", "Claude Opus 4.8"),
      model("gpt", "GPT-5.6", { provider: "openai", reasoning: false, vision: false }),
    ];
    const html = renderPage(
      <ModelPage
        models={models}
        visibleModels={models}
        providers={modelProviders(models)}
        activeProvider="all"
        currentModel={model("opus", "Claude Opus 4.8")}
        busy={false}
        onProvider={noop}
        onRefresh={noop}
        onBack={noop}
        onPick={noop}
      />,
    );
    expect(html).toContain("Claude Opus 4.8");
    expect(html).toContain("anthropic");
    expect(html).toContain("reasoning");
    expect(html).toContain("vision");
    expect(html).toContain("200k ctx");
    expect(html).toContain("GPT-5.6");
    expect(html).toContain("openai");
  });

  it("says so while the catalogue is loading", () => {
    const html = renderPage(
      <ModelPage
        models={[]}
        visibleModels={[]}
        providers={[]}
        activeProvider="all"
        busy={false}
        onProvider={noop}
        onRefresh={noop}
        onBack={noop}
        onPick={noop}
      />,
    );
    expect(html).toContain("Loading the catalogue…");
  });

  it("shows which action is in flight", () => {
    const html = renderToStaticMarkup(
      <QuickActions {...base} models={[]} busyAction="session_compact" />,
    );
    expect(html).toContain("working…");
  });

  it("shows the model switch in flight", () => {
    const html = renderToStaticMarkup(<QuickActions {...base} models={[]} busyAction="model_set" />);
    expect(html).toContain("switching…");
  });

  it("hides the new-session confirmation until it is asked for", () => {
    const html = renderToStaticMarkup(<QuickActions {...base} models={[]} />);
    expect(html).not.toContain("clear the Pi-side conversation?");
  });

  it("offers a provider filter derived from the catalogue", () => {
    const models = [model("opus", "Opus"), model("gpt", "GPT", { provider: "openai" })];
    const html = renderPage(
      <ModelPage
        models={models}
        visibleModels={models}
        providers={modelProviders(models)}
        activeProvider="all"
        busy={false}
        onProvider={noop}
        onRefresh={noop}
        onBack={noop}
        onPick={noop}
      />,
    );
    expect(html).toContain('aria-label="Provider filter"');
    expect(html).toContain(">all<");
    expect(html).toContain(">anthropic<");
    expect(html).toContain(">openai<");
  });
});

describe("model catalogue helpers", () => {
  const model = (id: string, provider: string): WireModel => ({
    id,
    name: id,
    provider,
    reasoning: false,
    context_window: 1000,
    vision: false,
  });

  it("lists each provider once, in catalogue order", () => {
    expect(modelProviders([model("a", "anthropic"), model("b", "openai"), model("c", "anthropic")])).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("filters by provider, and 'all' is a no-op", () => {
    const models = [model("a", "anthropic"), model("b", "openai")];
    expect(filterModelsByProvider(models, "all")).toBe(models);
    expect(filterModelsByProvider(models, "openai").map((m) => m.id)).toEqual(["b"]);
  });
});

describe("composer vision gating", () => {
  const base = { directory: "/tmp", onSend: noop, onInterrupt: noop, onQueue: noop };
  const model = (vision: boolean): WireModel => ({
    id: "m",
    name: "M",
    provider: "anthropic",
    reasoning: true,
    context_window: 1000,
    vision,
  });

  it("blocks attachments when the current model cannot see images", () => {
    const html = renderToStaticMarkup(<Composer {...base} currentModel={model(false)} />);
    expect(html).toContain("The current model cannot see images");
    expect(html).toContain('disabled=""');
  });

  it("allows attachments when the model has vision", () => {
    const html = renderToStaticMarkup(<Composer {...base} currentModel={model(true)} />);
    expect(html).not.toContain("cannot see images");
    expect(html).not.toContain('disabled=""');
  });
});

describe("voice input", () => {
  const base = { directory: "/tmp", onSend: noop, onInterrupt: noop, onQueue: noop };

  class StubRecognition {
    lang = "";
    interimResults = false;
    continuous = true;
    maxAlternatives = 1;
    onresult = null;
    onerror = null;
    onend = null;
    start() {}
    stop() {}
    abort() {}
  }

  it("offers a dictation control only when the platform supports it", () => {
    // Node has no SpeechRecognition: the control stays hidden.
    expect(renderToStaticMarkup(<Composer {...base} />)).not.toContain(">voice<");

    (globalThis as Record<string, unknown>).SpeechRecognition = StubRecognition;
    try {
      const html = renderToStaticMarkup(<Composer {...base} />);
      expect(html).toContain(">voice<");
      expect(html).toContain("Dictate a message");
    } finally {
      delete (globalThis as Record<string, unknown>).SpeechRecognition;
    }
  });
});

describe("new session confirmation", () => {
  it("spells out the consequence with confirm and cancel", () => {
    const html = renderToStaticMarkup(<NewSessionConfirm onConfirm={noop} onCancel={noop} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("clear the Pi-side conversation?");
    expect(html).toContain("confirm");
    expect(html).toContain("cancel");
  });
});

describe("editable draft queue", () => {
  const base = { directory: "/tmp", onSend: noop, onInterrupt: noop, onQueue: noop };

  it("turns the queued draft into a control that pulls it back", () => {
    const html = renderToStaticMarkup(<Composer {...base} queuedText="do the thing" />);
    expect(html).toContain("queued: do the thing");
    expect(html).toContain('title="Pull this queued draft back into the composer"');
    // The old nested clear button is gone; the row itself is the control.
    expect(html).not.toContain(">clear<");
  });
});

describe("hide tool calls preference", () => {
  const withTool = applyMessage(emptyTranscript, {
    type: "tool_request",
    tool_call_id: "t1",
    tool: "Bash",
    args: { command: "ls" },
  });

  it("shows tool calls by default", () => {
    expect(renderToStaticMarkup(<Transcript state={withTool} onAnswer={noop} />)).toContain("⏺");
  });

  it("filters tool calls out of the scrollback when asked", () => {
    const html = renderToStaticMarkup(
      <Transcript state={withTool} onAnswer={noop} hideToolCalls />,
    );
    expect(html).not.toContain("⏺");
    expect(html).not.toContain("Bash");
  });
});

describe("settings panel", () => {
  const base = {
    open: true,
    onOpenChange: noop,
    relayUrl: "wss://relay.example/ws",
    onSaveRelayUrl: noop,
    theme: "system" as const,
    onSetTheme: noop,
    hideToolCalls: false,
    onToggleHideToolCalls: noop,
    voiceNoticeAck: false,
    onAckVoiceNotice: noop,
  };

  it("shows the relay, preferences, disclosure and device key", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel {...base} devicePubkey="aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789" />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Settings");
    expect(html).toContain("wss://relay.example/ws");
    expect(html).toContain("hide tool calls: off");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("audio may leave this device");
    expect(html).toContain("got it");
    // The device key is truncated, not printed in full.
    expect(html).not.toContain("aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    expect(html).toContain("aBcDeFgHiJkLmNoPqRsT…");
  });

  it("offers a theme switcher with the current mode selected", () => {
    const html = renderToStaticMarkup(<SettingsPanel {...base} theme="light" />);
    expect(html).toContain('aria-label="Theme"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("❯ light");
    expect(html).toContain('aria-checked="true"');
  });

  it("reflects the acknowledged disclosure and hidden tool calls", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel {...base} hideToolCalls voiceNoticeAck />,
    );
    expect(html).toContain("hide tool calls: on");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("noted");
  });
});

describe("session info panel", () => {
  it("renders every field from the live session", () => {
    const html = renderToStaticMarkup(
      <SessionInfo
        open
        onOpenChange={noop}
        info={{
          name: "remote_pi",
          host: "mac-mini",
          path: "/Users/me/www/github/remote_pi",
          room: "main",
          model: "Claude Opus 4.8",
          thinking: "high",
          relay: "wss://relay.example/ws",
          pairedAt: "2026-09-20T12:00:00.000Z",
          owner: "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
        }}
      />,
    );
    expect(html).toContain("Session info");
    for (const label of [
      "Name",
      "Host",
      "Path",
      "Room",
      "Model",
      "Thinking",
      "Relay",
      "Paired",
      "Owner",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("remote_pi");
    expect(html).toContain("/Users/me/www/github/remote_pi");
    expect(html).toContain("Claude Opus 4.8");
    expect(html).toContain("wss://relay.example/ws");
    // The owner key is truncated, not printed in full.
    expect(html).not.toContain("aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    expect(html).toContain("aBcDeFgHiJkLmNoPqRsT…");
  });

  it("falls back to an em dash for missing fields", () => {
    const html = renderToStaticMarkup(<SessionInfo open onOpenChange={noop} info={{}} />);
    expect(html).toContain("—");
  });
});

describe("session menu", () => {
  const base = {
    open: true,
    onOpenChange: noop,
    onSettings: noop,
    onResync: noop,
    onReconnect: noop,
  };

  it("collapses settings, resync and reconnect behind one menu", () => {
    const html = renderToStaticMarkup(<SessionMenu {...base} />);
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Session menu"');
    expect(html).toContain(">settings<");
    expect(html).toContain(">resync<");
    expect(html).toContain(">reconnect<");
  });

  it("only exposes a labelled trigger while closed", () => {
    const html = renderToStaticMarkup(<SessionMenu {...base} open={false} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">menu<");
    expect(html).not.toContain('role="menu"');
  });
});

describe("composer interrupt", () => {
  const base = { directory: "/tmp", onSend: noop, onInterrupt: noop, onQueue: noop };

  it("offers a clickable interrupt while a turn runs", () => {
    const html = renderToStaticMarkup(<Composer {...base} working />);
    expect(html).toContain(">interrupt<");
    expect(html).toContain('title="Stop the running turn"');
  });

  it("hides the interrupt when idle", () => {
    const html = renderToStaticMarkup(<Composer {...base} />);
    expect(html).not.toContain(">interrupt<");
  });
});

describe("dialog sizing", () => {
  it("keeps the dialog inside the viewport on small screens", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        open
        onOpenChange={noop}
        relayUrl="wss://relay.example/ws"
        onSaveRelayUrl={noop}
        theme="system"
        onSetTheme={noop}
        hideToolCalls={false}
        onToggleHideToolCalls={noop}
        voiceNoticeAck={false}
        onAckVoiceNotice={noop}
      />,
    );
    // `max-w-[calc(100%-2rem)]` is invalid CSS (calc needs spaces around the
    // operator) and used to let the dialog overflow the phone viewport.
    expect(html).toContain("w-[calc(100%_-_2rem)]");
    expect(html).not.toContain("max-w-[calc(100%-2rem)]");
  });
});

describe("ui chrome", () => {
  it("renders the session title as a dim chip", () => {
    const html = renderToStaticMarkup(<SessionTitle title="Build remote_pi" />);
    expect(html).toContain("title: Build remote_pi");
  });

  it("renders nothing for empty props", () => {
    expect(renderToStaticMarkup(<SessionTitle />)).toBe("");
    expect(renderToStaticMarkup(<StatusList statuses={{}} />)).toBe("");
    expect(renderToStaticMarkup(<WidgetList widgets={{}} />)).toBe("");
  });

  it("renders one line per status entry", () => {
    const html = renderToStaticMarkup(
      <StatusList statuses={{ goal: "running", tests: "green" }} />,
    );
    expect(html).toContain("goal:");
    expect(html).toContain("running");
    expect(html).toContain("tests:");
    expect(html).toContain("green");
  });

  it("renders each widget's label and its lines", () => {
    const html = renderToStaticMarkup(
      <WidgetList
        widgets={{ todo: { lines: ["- [ ] wire", "- [x] pair"], placement: "aboveEditor" } }}
      />,
    );
    expect(html).toContain("todo");
    expect(html).toContain("- [ ] wire");
    expect(html).toContain("- [x] pair");
    expect(html).toContain("whitespace-pre-wrap");
  });
});
