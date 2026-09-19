"use client";

/**
 * Quick actions panel — the web counterpart of the app's Quick Actions sheet.
 *
 * Rendered as a shadcn `Command` palette inside a dialog, with multi-level
 * navigation (root → thinking / model / confirm) so the same surface exposes
 * the four typed protocol actions (`session_compact`, `session_new`,
 * `model_set`, `thinking_set`) plus the model catalogue fetch that feeds
 * `model_set`. `cmdk` owns filtering and keyboard selection per page.
 */

import { useEffect, useState } from "react";

import type { ActionName, ThinkingLevel, WireModel } from "@/lib/protocol/types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

const FG = "var(--pi-fg)";
const MUTED = "var(--pi-muted)";
const DIM = "var(--pi-dim)";
const ROSE = "var(--pi-rose)";
const CYAN = "var(--pi-cyan)";

/** Same short labels the app's segmented control uses. */
const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "x",
};

const THINKING_ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** Distinct providers in catalogue order — the filter rows on the model page. */
export function modelProviders(models: WireModel[]): string[] {
  const providers: string[] = [];
  for (const model of models) {
    if (model.provider && !providers.includes(model.provider)) providers.push(model.provider);
  }
  return providers;
}

/** `all` (or a filter no longer in the catalogue) is a no-op. */
export function filterModelsByProvider(models: WireModel[], provider: string): WireModel[] {
  if (!provider || provider === "all") return models;
  return models.filter((model) => model.provider === provider);
}

type Page = "root" | "thinking" | "model" | "confirm";

/** `name · provider · reasoning · vision · Nk ctx`, the app's model subtitle. */
function modelMeta(model: WireModel): string {
  const parts = [model.provider];
  if (model.reasoning) parts.push("reasoning");
  if (model.vision) parts.push("vision");
  if (model.context_window) parts.push(`${Math.round(model.context_window / 1000)}k ctx`);
  return parts.join(" · ");
}

export function QuickActions({
  open,
  onOpenChange,
  busyAction,
  modelName,
  currentModel,
  models,
  thinking,
  onCompact,
  onNewSession,
  onListModels,
  onPickModel,
  onPickThinking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busyAction?: ActionName;
  modelName?: string;
  currentModel?: WireModel;
  models: WireModel[];
  thinking?: ThinkingLevel;
  onCompact: () => void;
  onNewSession: () => void;
  onListModels: () => void;
  onPickModel: (model: WireModel) => void;
  onPickThinking: (level: ThinkingLevel) => void;
}) {
  const [page, setPage] = useState<Page>("root");
  const [provider, setProvider] = useState("all");

  // Always reopen on the root page, and refresh the catalogue so the list is
  // real rather than whatever the room meta happened to name.
  useEffect(() => {
    if (!open) return;
    setPage("root");
    onListModels();
  }, [open, onListModels]);

  const providers = modelProviders(models);
  const activeProvider = provider !== "all" && !providers.includes(provider) ? "all" : provider;
  const visibleModels = filterModelsByProvider(models, activeProvider);

  const placeholder =
    page === "model"
      ? "Search models…"
      : page === "thinking"
        ? "Search thinking levels…"
        : page === "confirm"
          ? "Confirm…"
          : "Search actions…";

  const close = () => onOpenChange(false);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick actions"
      description="Compact context, start a new session, and pick thinking or model."
      className="max-w-md"
    >
      <CommandInput placeholder={placeholder} />

      {page === "root" ? (
        <RootPage
          busyAction={busyAction}
          modelName={modelName}
          thinking={thinking}
          onCompact={() => {
            onCompact();
            close();
          }}
          onNewSession={() => setPage("confirm")}
          onThinking={() => setPage("thinking")}
          onModel={() => setPage("model")}
        />
      ) : null}

      {page === "thinking" ? (
        <ThinkingPage
          currentModel={currentModel}
          thinking={thinking}
          busy={busyAction === "thinking_set"}
          onBack={() => setPage("root")}
          onPick={(level) => {
            onPickThinking(level);
            setPage("root");
          }}
        />
      ) : null}

      {page === "model" ? (
        <ModelPage
          models={models}
          visibleModels={visibleModels}
          providers={providers}
          activeProvider={activeProvider}
          currentModel={currentModel}
          busy={busyAction === "model_set"}
          onProvider={setProvider}
          onRefresh={onListModels}
          onBack={() => setPage("root")}
          onPick={(model) => {
            onPickModel(model);
            setPage("root");
          }}
        />
      ) : null}

      {page === "confirm" ? (
        <ConfirmPage
          busy={busyAction === "session_new"}
          onBack={() => setPage("root")}
          onConfirm={() => {
            onNewSession();
            close();
          }}
        />
      ) : null}
    </CommandDialog>
  );
}

/** Exported for render tests: the root list is the only one reachable without navigation. */
export function RootPage({
  busyAction,
  modelName,
  thinking,
  onCompact,
  onNewSession,
  onThinking,
  onModel,
}: {
  busyAction?: ActionName;
  modelName?: string;
  thinking?: ThinkingLevel;
  onCompact: () => void;
  onNewSession: () => void;
  onThinking: () => void;
  onModel: () => void;
}) {
  return (
    <CommandList>
      <CommandEmpty>No matching action.</CommandEmpty>
      <CommandGroup heading="Session">
        <CommandItem value="compact context" onSelect={onCompact} disabled={busyAction === "session_compact"}>
          <span style={{ color: FG }}>Compact context</span>
          {busyAction === "session_compact" ? (
            <CommandShortcut style={{ color: CYAN }}>working…</CommandShortcut>
          ) : (
            <CommandShortcut>summarize old turns</CommandShortcut>
          )}
        </CommandItem>
        <CommandItem value="new session" onSelect={onNewSession} disabled={busyAction === "session_new"}>
          <span style={{ color: FG }}>New session</span>
          <CommandShortcut>clears the Pi-side conversation</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Model">
        <CommandItem value="thinking level" onSelect={onThinking}>
          <span style={{ color: FG }}>Thinking</span>
          <CommandShortcut>
            {thinking ? THINKING_LABELS[thinking] : "—"}
            {busyAction === "thinking_set" ? " · saving…" : ""} ›
          </CommandShortcut>
        </CommandItem>
        <CommandItem value="model picker" onSelect={onModel}>
          <span style={{ color: FG }}>Model</span>
          <CommandShortcut>
            {modelName ?? "—"}
            {busyAction === "model_set" ? " · switching…" : ""} ›
          </CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  );
}

export function ThinkingPage({
  currentModel,
  thinking,
  busy,
  onBack,
  onPick,
}: {
  currentModel?: WireModel;
  thinking?: ThinkingLevel;
  busy: boolean;
  onBack: () => void;
  onPick: (level: ThinkingLevel) => void;
}) {
  return (
    <CommandList>
      <CommandGroup heading={`Thinking${busy ? " · saving…" : ""}`}>
        <CommandItem value="back" onSelect={onBack}>
          ← back
        </CommandItem>
        <CommandSeparator />
        {THINKING_ORDER.map((level) => {
          const selected = thinking === level;
          // `xhigh` is only honoured by some model families; grey it out when
          // the catalogue says the current model is not a reasoning model.
          const disabled = level !== "off" && currentModel ? !currentModel.reasoning : false;
          return (
            <CommandItem
              key={level}
              value={`thinking ${level}`}
              disabled={disabled}
              onSelect={() => (disabled ? undefined : onPick(level))}
            >
              <span style={{ color: selected ? ROSE : FG }}>{selected ? "❯ " : "  "}</span>
              <span style={{ color: FG }}>{THINKING_LABELS[level]}</span>
              <CommandShortcut>{disabled ? "unavailable for this model" : level}</CommandShortcut>
            </CommandItem>
          );
        })}
      </CommandGroup>
    </CommandList>
  );
}

export function ModelPage({
  models,
  visibleModels,
  providers,
  activeProvider,
  currentModel,
  busy,
  onProvider,
  onRefresh,
  onBack,
  onPick,
}: {
  models: WireModel[];
  visibleModels: WireModel[];
  providers: string[];
  activeProvider: string;
  currentModel?: WireModel;
  busy: boolean;
  onProvider: (provider: string) => void;
  onRefresh: () => void;
  onBack: () => void;
  onPick: (model: WireModel) => void;
}) {
  return (
    <CommandList>
      <CommandGroup heading="Catalogue">
        <CommandItem value="back" onSelect={onBack}>
          ← back
        </CommandItem>
        <CommandItem value="refresh catalogue" onSelect={onRefresh}>
          <span style={{ color: FG }}>refresh</span>
          {busy ? <CommandShortcut style={{ color: CYAN }}>switching…</CommandShortcut> : null}
        </CommandItem>
      </CommandGroup>
      {providers.length > 1 ? (
        <CommandGroup heading="Provider" aria-label="Provider filter">
          {["all", ...providers].map((value) => (
            <CommandItem key={value} value={`provider ${value}`} onSelect={() => onProvider(value)}>
              <span style={{ color: activeProvider === value ? ROSE : FG }}>
                {activeProvider === value ? "❯ " : "  "}
              </span>
              <span style={{ color: activeProvider === value ? FG : MUTED }}>{value}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      <CommandGroup heading="Models">
        {models.length === 0 ? (
          <CommandItem value="loading" disabled>
            Loading the catalogue…
          </CommandItem>
        ) : visibleModels.length === 0 ? (
          <CommandItem value="empty" disabled>
            No models for this provider.
          </CommandItem>
        ) : (
          visibleModels.map((model) => {
            const selected =
              currentModel?.id === model.id && currentModel?.provider === model.provider;
            return (
              <CommandItem
                key={`${model.provider}/${model.id}`}
                value={`${model.name} ${model.provider} ${model.id}`}
                onSelect={() => onPick(model)}
              >
                <span style={{ color: selected ? ROSE : FG }}>{selected ? "❯ " : "  "}</span>
                <span style={{ color: selected ? FG : MUTED }}>{model.name}</span>
                <CommandShortcut>{modelMeta(model)}</CommandShortcut>
              </CommandItem>
            );
          })
        )}
      </CommandGroup>
    </CommandList>
  );
}

function ConfirmPage({
  busy,
  onBack,
  onConfirm,
}: {
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <CommandList>
      <CommandGroup heading="New session" role="alert">
        <div className="px-2 py-1 text-[12px]" style={{ color: FG }}>
          clear the Pi-side conversation?
        </div>
        <CommandItem value="confirm" onSelect={onConfirm} disabled={busy}>
          <span style={{ color: ROSE }}>confirm</span>
        </CommandItem>
        <CommandItem value="cancel" onSelect={onBack}>
          <span style={{ color: MUTED }}>cancel</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  );
}

/**
 * Inline confirmation for the destructive `session_new` action. Kept exported
 * (and self-contained) so it can be render-tested in both states without
 * driving a click; the Command palette above uses `ConfirmPage` instead.
 */
export function NewSessionConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-2" role="alert">
      <span style={{ color: FG }}>clear the Pi-side conversation?</span>
      <button
        type="button"
        onClick={onConfirm}
        className="underline-offset-2 hover:underline"
        style={{ color: ROSE }}
      >
        confirm
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="underline-offset-2 hover:underline"
        style={{ color: MUTED }}
      >
        cancel
      </button>
    </div>
  );
}
