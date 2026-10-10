# Running remote-pi under omp (oh-my-pi)

remote-pi ships as **one extension for two hosts**. This document records how the
two differ, what is verified, and where the seams are.

| | pi | omp |
|---|---|---|
| package | `@earendil-works/pi-coding-agent` | `@oh-my-pi/pi-coding-agent` |
| binary | `pi` | `omp` |
| engine | Node ≥22 | Bun (Bun 1.3.14 verified locally) |
| user state | `~/.pi` | `~/.omp` |
| agent dir | `~/.pi/agent` | `~/.omp/agent` |
| project state | `<cwd>/.pi` | `<cwd>/.omp` |
| package manifest | `pkg.pi.extensions` | `pkg.omp.extensions` (falls back to `pkg.pi`) |
| extension loading | bundled `dist/` JS | `src/` TypeScript via Bun; legacy pi modules run through `extensibility/legacy-pi-*.ts` shims |

omp is a fork of pi by Stencil Labs (pi's original author is a contributor). It
keeps an explicit, deliberate compatibility layer for pi extensions —
`extensibility/plugins/legacy-pi-compat.ts` (`PI_SCOPE_ALIASES = ["oh-my-pi",
"mariozechner", "earendil-works"]`), `legacy-pi-coding-agent-shim.ts`,
`legacy-pi-ai-shim.ts`, `legacy-pi-tui-shim.ts`, `legacy-typebox.ts` — and its own
porting guide states removing them "would break existing pi extensions".

**Consequence: remote-pi needs no source-level port.** `@earendil-works/*`
imports (including `SettingsManager` and `convertToPng`) resolve through the
shim, and `registerTool`'s `parameters` field is documented in omp as "Zod, **or
TypeBox for legacy/extension compat**" — the TypeBox work in `src/mcp/mesh_server.ts`
is load-bearing here, not incidental.

## State isolation (`src/runtime.ts`)

The two hosts are kept as **independent meshes**. They are not shareable: each
speaks its own RPC dialect and session-entry payload union, so a shared root
would put a `pi` and an `omp` daemon behind one broker socket with one
`daemons.json` and no way to know which dialect a peer expects.

```
pi   →  ~/.pi/remote   {config,peers,daemons,cron}.json, identity.json,
                       sessions/local/broker.sock, supervisor.sock, locks/, skills/
omp  →  ~/.omp/remote  (same layout)
```

Project-local config follows suit: `<cwd>/.pi/remote-pi/config.json` under pi,
`<cwd>/.omp/remote-pi/config.json` under omp. A folder configured for one host is
therefore **not** silently picked up by the other.

`REMOTE_PI_HOME` overrides the base directory (the `.<host>` segment is still
appended, so the override stays per-host — existing tests and ops keep working).

### Host detection precedence

1. **`REMOTE_PI_HOST`** = `pi` | `omp` — explicit pin, for tests and QA.
2. **The live `ExtensionAPI`** — `noteExtensionApi(pi)` is called first thing in
   the extension factory. omp injects its own module namespaces onto the API
   (`arktype`, `zod`, `typebox`, `pi`, `logger`); earendil injects **none**, and
   `arktype` exists in omp's dist but has **zero** occurrences in earendil's. Its
   presence is therefore a positive omp identification. Absence is deliberately
   *not* treated as `pi`, so a partial/mocked API can't override a pin.
3. **Process heuristics** — `argv[1]` / `execPath` / `$_` under an `@oh-my-pi`
   install, or a final path segment of exactly `omp`. These bootstrap callers that
   run before the factory (module-level paths, CLI entry points).
4. **`pi`** — the conservative default. Guessing `omp` wrongly would point a `pi`
   session at the other host's mesh, so an unrecognised runtime must fall back.

`remote-pi config` / `status` can surface the resolved layout; `describeLayout()`
exposes `{ host, source, remoteRoot }`.

## Verified (omp v18.8.6)

- **Extension loads and registers.** `omp --mode rpc --no-extensions -e dist/index.js`
  → `{"type":"ready",...}` followed by `available_commands_update` carrying all 23
  `/remote-pi*` commands with `"source":"extension"`.
- **Host detection inside omp.** Probe extension printed
  `host=omp, source=process, bin=omp, remoteRoot=~/.omp/remote,
  projectConfig=<cwd>/.omp/remote-pi`, running on `Bun 1.3.14`, with the injected
  API exposing `arktype`.
- **Daemon spawn vector is accepted.** `omp --mode rpc --continue -e dist/index.js`
  → `rc=0`, `ready` frame, **empty stderr**, commands registered. (This is the
  vector `rpcSpawnArgs` now produces for omp.)
- **RPC surface we depend on is compatible.** omp's `get_state` payload carries
  `isStreaming` (used by `RpcChild.refreshBusy`), and it emits/accepts
  `extension_ui_request` / `extension_ui_response` with the same
  `{type,id,method}` / `{type,id,value|cancelled}` shape `extension_ui_bridge.ts`
  expects.

## Host differences that are handled

### Flags (`src/daemon/rpc_child.ts`)

omp **rejects unknown flags outright** (`Error: unknown flag: --approve`, exit 2),
so pi's argument vector cannot be reused verbatim:

| arg | pi | omp |
|---|---|---|
| `--approve` | required (project-trust gate for non-interactive RPC) | **rejected**; omitted. omp has no equivalent trust gate (project config applies by default) |
| `--name <n>` | pins the session display name | **rejected**; omitted. `--continue` still gives a stable session; only the display name is auto-generated |
| `--continue` | ✓ | ✓ (needs session persistence — don't combine with `--no-session`) |

We deliberately pass **no** approval flag under omp rather than forcing
`--auto-approve`, so a user's explicit `tools.approvalMode: always-ask`/`write`
keeps deciding — matching "daemons inherit the same config the interactive run
uses". omp's `tools.approvalMode` already defaults to `yolo`.

### Binary (`runtime.ts` → `hostBinName()`)

`RpcChild` defaults to the host binary (`omp` under omp, `pi` under pi).
Explicit `piBin` (tests, `supervisor.ts:110`) still wins.

### Service templates

Templates invoke only `{NODE} {SUPERVISOR}`, and the supervisor spawns the host
binary itself, so no template changes the agent binary. The launchd log path now
uses `{LOG}` (was hardcoded to `~/.pi/remote/...`), so it follows the host.

## Known gaps

1. **`ctx.ui.setFooter()` / `setHeader()` are no-op stubs in omp.** The footer /
   status-line integration in `src/ui/footer.ts` silently does nothing under omp.
   omp uses its own `StatusLineComponent` instead. Harmless (the calls are void)
   but the relay/state footer is simply absent. No fix planned; would need an
   omp-native status-line API.
2. **`get_commands` is not served by omp.** It answers
   `get_available_commands` (a richer, deliberately incompatible catalog). Any
   client code that called pi's `get_commands` would break. Nothing in
   `remote-pi` calls it today.
3. **Session-entry payloads are not wire-identical.** `get_entries`/`get_tree` are
   Pi-compatible *commands*, but Pi's `model_change` carries `provider` +
   `modelId` where omp carries a combined `model` plus role/fallback metadata, Pi
   uses `usage` where omp uses `model_usage`, and omp adds entry types. A
   permissive consumer of the common structural subset (`id`/`parentId` + message
   entries) is safe; a strict Pi `SessionEntry` decoder is not.
4. **`agent_settled` does not exist in omp.** omp reports quiescence via
   `session_settled`, and `agent_end` carries `isTerminal`/`yielded`/
   `awaitingAsyncWork`.
5. **The CLI shims assume `node` on PATH.** `linkCliBinaries` symlinks
   `dist/index.js` / `dist/bin/supervisord.js`, whose shebangs are
   `#!/usr/bin/env node`. On a Bun-only machine with no Node, use
   `bun ~/.local/bin/remote-pi …`. `engines.node >= 20` means Node is normally
   present.
6. **`pi-supervisord` keeps its name** under omp (it is the published `bin` entry).
   Only its *behaviour* is host-aware.
7. **Manifest field.** `package.json` now declares both `pi` and `omp` with the
   same `extensions: ["./dist"]`. `pkg.omp` is preferred by omp and `pkg.pi` is
   the documented fallback, so either field alone would work; both are declared so
   the intent is explicit.

## Installing under omp

```bash
# Local development
omp --no-extensions -e "$(pwd)/pi-extension/dist/index.js"

# As a package (omp's plugin manager reads pkg.omp ?? pkg.pi)
omp plugin link <path-to-checkout>/pi-extension
omp plugin list
```

There is no `pi install` equivalent to run *for* the user; omp discovers extension
packages through `extensions:` in settings, `--extension`/`-e`, or its plugin
manager.

## Verifying

```bash
cd pi-extension
pnpm typecheck && pnpm build && pnpm test

# Host detection + state root inside omp
omp --mode rpc --no-session --no-extensions -e <probe-extension printing getHost()>

# Daemon arg vector is accepted (must print a ready frame, empty stderr)
omp --mode rpc --continue -e "$(pwd)/pi-extension/dist/index.js" < /dev/null
```

> `src/extension.test.ts` has a **pre-existing flake** unrelated to this work: a
> hard-coded `await setTimeout(20)` at `extension.test.ts:4779` and the
> `cwd_lock`/`waitFor` races around it fail ~1 run in 4 under load. Reproduced on
> the pre-omp tree at `4b4c099b`, so it is not a regression from the omp work.
