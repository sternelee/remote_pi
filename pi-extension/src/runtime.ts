import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runtime identity and the filesystem roots derived from it.
 *
 * remote-pi is one extension for two hosts that share a lineage but diverge in
 * ways that matter to a *stateful* extension:
 *
 *   pi   `@earendil-works/pi-coding-agent`   → state under `~/.pi/remote`
 *   omp  `@oh-my-pi/pi-coding-agent`         → state under `~/.omp/remote`
 *
 * The two are deliberately **independent meshes**: separate pairing identity,
 * `peers.json`, `daemons.json`, cron state, cwd locks and broker socket. They
 * are NOT shareable — each host speaks its own RPC dialect over the broker, so
 * a shared root would put an `omp` daemon and a `pi` daemon behind one socket
 * with one registry and no way to tell which dialect a peer expects.
 *
 * Detection signals, in precedence order:
 *
 *   1. `REMOTE_PI_HOST` — explicit pin (`pi` | `omp`). For tests and QA.
 *   2. The live `ExtensionAPI` — see {@link noteExtensionApi}. Authoritative,
 *      and the only signal that cannot be fooled by how the process was
 *      launched.
 *   3. Process heuristics — the CLI entry point / `execPath` living under an
 *      `@oh-my-pi` install, or an `omp` binary. Bootstraps callers that run
 *      before the extension factory has been invoked (module-level paths,
 *      the CLI entry points).
 *   4. `"pi"` — the conservative default. A wrong guess of `omp` would point a
 *      `pi` session at the other host's mesh, so an unrecognised runtime must
 *      fall back to `pi`.
 *
 * `REMOTE_PI_HOME` (already honored by the daemon registry and cwd locks)
 * overrides the *base* directory; the `.<host>` segment is still appended, so
 * that override keeps working per-host.
 */

export type HostId = "pi" | "omp";

/** How the host was decided. Surfaced by `remote-pi config`/`status` for QA. */
export type HostSource = "env" | "api" | "process" | "default";

const HOST_ENV = "REMOTE_PI_HOST";
const HOME_ENV = "REMOTE_PI_HOME";

let _host: HostId | null = null;
let _source: HostSource = "default";

function _parseHost(value: string | undefined): HostId | null {
  const v = value?.trim().toLowerCase();
  return v === "pi" || v === "omp" ? v : null;
}

/**
 * Positive, conservative `omp` signals from how this process was launched.
 *
 * Only two shapes are trusted: a path inside an `@oh-my-pi` package, or a path
 * whose final segment is literally `omp` (a PATH shim / compiled binary). A
 * looser match (`/omp/` anywhere, substring `omp`) would misfire on unrelated
 * paths and silently relocate a `pi` install's state.
 */
function _processHost(): HostId | null {
  const probes = [process.argv[1], process.execPath, process.env["_"]];
  for (const probe of probes) {
    if (typeof probe !== "string" || probe === "") continue;
    const p = probe.toLowerCase();
    if (p.includes("oh-my-pi") || p.includes("@oh-my-pi")) return "omp";
    if (/(^|[\\/])omp(\.exe|\.cmd)?$/.test(p)) return "omp";
  }
  return null;
}

/**
 * Authoritative signal from the live `ExtensionAPI`.
 *
 * omp injects its own module namespaces onto the API (`typebox`, `arktype`,
 * `zod`, `pi`, `logger`); earendil's `ExtensionAPI` injects none of them. So
 * the presence of `arktype` — omp's omptype builder, for which earendil has no
 * counterpart at all — positively identifies omp.
 *
 * Absence is deliberately NOT treated as "pi": a partial/mocked API in tests
 * must not override an explicit `REMOTE_PI_HOST` pin or a process signal.
 */
function _apiHost(api: unknown): HostId | null {
  if (!api || typeof api !== "object") return null;
  return "arktype" in (api as Record<string, unknown>) ? "omp" : null;
}

/** Resolve the host without caching, for callers that only want to observe. */
export function peekHost(): HostId {
  return _parseHost(process.env[HOST_ENV]) ?? _processHost() ?? "pi";
}

/**
 * Record the host from the live `ExtensionAPI`. Called once by the extension
 * factory as soon as it receives the API, which makes every path derived
 * afterwards authoritative. Returns the resolved host.
 */
export function noteExtensionApi(api: unknown): HostId {
  const fromEnv = _parseHost(process.env[HOST_ENV]);
  if (fromEnv) {
    _host = fromEnv;
    _source = "env";
    return fromEnv;
  }
  const fromApi = _apiHost(api);
  if (fromApi) {
    _host = fromApi;
    _source = "api";
    return fromApi;
  }
  return getHost();
}

/** The host this extension is running inside. */
export function getHost(): HostId {
  if (_host) return _host;
  const fromEnv = _parseHost(process.env[HOST_ENV]);
  if (fromEnv) {
    _host = fromEnv;
    _source = "env";
    return fromEnv;
  }
  const fromProc = _processHost();
  if (fromProc) {
    _host = fromProc;
    _source = "process";
    return fromProc;
  }
  _host = "pi";
  _source = "default";
  return "pi";
}

/** How {@link getHost} reached its answer. */
export function hostSource(): HostSource {
  getHost();
  return _source;
}

/** Test seam: force (`"pi"`/`"omp"`) or clear (`null`) the cached host. */
export function setHostForTest(host: HostId | null): void {
  _host = host;
  _source = host ? "env" : "default";
}

/** `".pi"` or `".omp"` — the host's user-level dot-directory name. */
export function userDirName(): string {
  return `.${getHost()}`;
}

/**
 * The base directory that hosts `.<host>/` — `$REMOTE_PI_HOME` or the user's
 * home. Resolved per call (never cached in a module-level const) so tests can
 * retarget it and so a late host decision is still honored.
 */
export function stateBaseDir(): string {
  return process.env[HOME_ENV] || homedir();
}

/** `~/.pi/remote` or `~/.omp/remote` — remote-pi's own state root. */
export function remoteRoot(): string {
  return join(stateBaseDir(), userDirName(), "remote");
}

/** `~/.pi/agent` or `~/.omp/agent` — the host's own agent directory. */
export function agentDir(): string {
  return join(stateBaseDir(), userDirName(), "agent");
}

/** `~/.pi/agent/extensions` or `~/.omp/agent/extensions`. */
export function agentExtensionsDir(): string {
  return join(agentDir(), "extensions");
}

/** Project-local dot-directory name: `".pi"` or `".omp"`. */
export function projectDirName(): string {
  return `.${getHost()}`;
}

/**
 * Project-local remote-pi config dir for a folder: `<cwd>/.pi/remote-pi` or
 * `<cwd>/.omp/remote-pi`.
 *
 * Kept host-specific to match the home state root: a folder configured under
 * `pi` does not silently become an `omp` agent (and vice versa), because the
 * two hosts would otherwise share one lock and one broker registration while
 * disagreeing on the RPC dialect.
 */
export function projectConfigDir(cwd: string): string {
  return join(cwd, projectDirName(), "remote-pi");
}

/** The host CLI binary name — `omp` under omp, `pi` under pi. */
export function hostBinName(): string {
  return getHost();
}

/** Human-readable layout, for the `remote-pi config` / `status` readout. */
export function describeLayout(): { host: HostId; source: HostSource; remoteRoot: string } {
  return { host: getHost(), source: hostSource(), remoteRoot: remoteRoot() };
}
