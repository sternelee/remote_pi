/**
 * Browser-local persistence.
 *
 * Three stores, mirroring the two storages the protocol defines for the app
 * side (see `pairing.md` § Storage pós-pareamento) plus a settings store:
 *
 *   device    — singleton Ed25519 device key (the "device-level singleton")
 *   peers     — one record per paired Pi, keyed by the Pi's canonical pubkey
 *   settings  — relay URL override
 *
 * IndexedDB only exists in the browser, so every entry point throws a clear
 * error if called during SSR. All callers are client components.
 */

import type { StoredIdentity } from "../crypto/ed25519";
import type { ThemeMode } from "../theme";

const DB_NAME = "remote-pi-web";
const DB_VERSION = 1;

export const STORE_DEVICE = "device";
export const STORE_PEERS = "peers";
export const STORE_SETTINGS = "settings";

const DEVICE_KEY = "ed25519";

/** A paired Pi. Field names follow the protocol's storage contract. */
export interface PeerRecord {
  /** Standard base64 Ed25519 pubkey of the Pi — the relay peer id. */
  remote_epk: string;
  session_name: string;
  relay_url: string;
  /** ISO timestamp. */
  paired_at: string;
  /** Pi-side room this pairing addresses (plan/17). */
  room_id: string;
  hostname?: string;
  /** User-chosen label; falls back to `session_name` in the UI. */
  nickname?: string;
  /** `pair_ok.harness.name` — e.g. "Pi coding agent". */
  harness?: string;
  harness_version?: string;
}

export interface Settings {
  /** Relay URL in http(s) form; converted to ws(s) when connecting. */
  relay_url?: string;
  /**
   * Pubkey of the peer last connected to, so reopening the PWA reconnects
   * instead of dropping the user on the pairing screen.
   */
  last_peer_epk?: string;
  /** Hide `tool`/`diff` timeline entries in the transcript (app: hideToolCalls). */
  hide_tool_calls?: boolean;
  /** Set once the voice privacy disclosure has been shown. */
  voice_notice_ack?: boolean;
  /** Theme choice; `system` follows the OS and is the default. */
  theme?: ThemeMode;
  /**
   * Raise an OS notification when a turn finishes while the tab is hidden.
   * Off until the user asks for it: a browser notification is intrusive.
   */
  notify_on_finish?: boolean;
}

/** The camelCase preferences the session layer exposes to the UI. */
export interface Preferences {
  hideToolCalls: boolean;
  voiceNoticeAck: boolean;
  theme: ThemeMode;
  notifyOnFinish: boolean;
}

/** Defaults for a browser that has never saved settings. */
export function prefsFrom(settings?: Settings): Preferences {
  return {
    hideToolCalls: settings?.hide_tool_calls ?? false,
    voiceNoticeAck: settings?.voice_notice_ack ?? false,
    theme: settings?.theme ?? "system",
    notifyOnFinish: settings?.notify_on_finish ?? false,
  };
}

/** Translate a `Preferences` patch into its persisted `Settings` field names. */
export function settingsPatchForPrefs(patch: Partial<Preferences>): Settings {
  const out: Settings = {};
  if (patch.hideToolCalls !== undefined) out.hide_tool_calls = patch.hideToolCalls;
  if (patch.voiceNoticeAck !== undefined) out.voice_notice_ack = patch.voiceNoticeAck;
  if (patch.theme !== undefined) out.theme = patch.theme;
  if (patch.notifyOnFinish !== undefined) out.notify_on_finish = patch.notifyOnFinish;
  return out;
}

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable (server-side render)"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_DEVICE)) {
        database.createObjectStore(STORE_DEVICE);
      }
      if (!database.objectStoreNames.contains(STORE_PEERS)) {
        database.createObjectStore(STORE_PEERS, { keyPath: "remote_epk" });
      }
      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("failed to open IndexedDB"));
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        tx.oncomplete = () => database.close();
      }),
  );
}

// ── device identity ────────────────────────────────────────────────────────

export function loadIdentity(): Promise<StoredIdentity | undefined> {
  return run<StoredIdentity | undefined>(STORE_DEVICE, "readonly", (s) => s.get(DEVICE_KEY));
}

export function saveIdentity(identity: StoredIdentity): Promise<void> {
  return run<void>(STORE_DEVICE, "readwrite", (s) => s.put(identity, DEVICE_KEY));
}

// ── peers ──────────────────────────────────────────────────────────────────

export function listPeers(): Promise<PeerRecord[]> {
  return run<PeerRecord[]>(STORE_PEERS, "readonly", (s) => s.getAll());
}

export function savePeer(peer: PeerRecord): Promise<void> {
  return run<void>(STORE_PEERS, "readwrite", (s) => s.put(peer));
}

export function deletePeer(remoteEpk: string): Promise<void> {
  return run<void>(STORE_PEERS, "readwrite", (s) => s.delete(remoteEpk));
}

// ── settings ───────────────────────────────────────────────────────────────

export function loadSettings(): Promise<Settings | undefined> {
  return run<Settings | undefined>(STORE_SETTINGS, "readonly", (s) => s.get("app"));
}

export function saveSettings(settings: Settings): Promise<void> {
  return run<void>(STORE_SETTINGS, "readwrite", (s) => s.put(settings, "app"));
}

/**
 * Patch the settings record.
 *
 * `saveSettings` replaces the whole object, so writing one field (a relay URL,
 * the remembered peer, a preference) would silently drop the others. This reads
 * the current record first and merges the patch on top.
 */
export async function mergeSettings(patch: Settings): Promise<void> {
  const current = (await loadSettings()) ?? {};
  await saveSettings({ ...current, ...patch });
}
