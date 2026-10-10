import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ipcAddress, usesNamedPipe } from "./ipc.js";
import { remoteRoot } from "../runtime.js";

/** `<state root>/sessions`. Resolved per call — never frozen at import — so a
 *  `pi`↔`omp` host decision or a `REMOTE_PI_HOME` retarget is honored. */
function sessionsDirPath(): string {
  return join(remoteRoot(), "sessions");
}

/** `<state root>/skills` — where the agent-network skill is deployed. */
function skillsDirPath(): string {
  return join(remoteRoot(), "skills");
}
/**
 * Fixed UDS session name. The local mesh is single per machine — every Pi
 * process on the host shares this broker. Previous versions exposed
 * multi-session support (named sessions, leave/rename/sessions commands);
 * those were removed in the 2026-05-23 simplification because in practice
 * every install converged on one session anyway and multi-session UX added
 * friction without value.
 */
export const LOCAL_SESSION_NAME = "local";

/** Idempotently creates `<state root>/{sessions,skills}`. */
export function ensureGlobalDirs(): void {
  mkdirSync(sessionsDirPath(), { recursive: true });
  mkdirSync(skillsDirPath(), { recursive: true });
}

/**
 * Local-IPC address for a session's broker. POSIX → a `.sock` file under the
 * session dir; Windows → a per-user named pipe (plan/40). The `net` API treats
 * both the same; only the address string differs.
 */
export function sessionSockPath(name: string): string {
  return ipcAddress(`broker-${name}`, join(sessionsDirPath(), name, "broker.sock"));
}

/** Path to the audit log for a named session. */
export function sessionAuditPath(name: string): string {
  return join(sessionsDirPath(), name, "audit.jsonl");
}

/** Path to the session metadata JSON. */
export function sessionMetaPath(name: string): string {
  return join(sessionsDirPath(), name, "session.json");
}

export function sessionsDir(): string {
  return sessionsDirPath();
}

export function skillsDir(): string {
  return skillsDirPath();
}

/** Lists discovered session names from disk. */
export function listSessions(): string[] {
  ensureGlobalDirs();
  try {
    const dir = sessionsDirPath();
    return readdirSync(dir).filter((entry) => {
      try {
        return statSync(join(dir, entry)).isDirectory();
      } catch { return false; }
    });
  } catch {
    return [];
  }
}

/**
 * Heuristic: a session has an existing broker socket FILE (POSIX only). On
 * Windows the broker is a named pipe with no file to stat, so this returns
 * false — the authoritative liveness check there is a connect-probe
 * (`leader_election.tryConnect` / `client.supervisorOnline`), not this. Only
 * legacy `session/wizard.ts` consumes this.
 */
export function sessionHasSock(name: string): boolean {
  if (usesNamedPipe()) return false;
  return existsSync(sessionSockPath(name));
}
