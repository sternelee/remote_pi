"use client";

/**
 * Session orchestration: identity → pairing → relay connection → transcript.
 *
 * One `RelayClient` instance is reused for the whole session. Pairing runs on a
 * *temporary* client (it needs a peer id and room that only the QR knows),
 * after which the persistent client is pointed at the saved peer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  generateIdentity,
  isEd25519Supported,
  publicKeyB64Of,
  type StoredIdentity,
} from "../crypto/ed25519";
import { parseQrPayload, DEFAULT_RELAY_URL, toWsRelayUrl } from "../pairing/qr";
import { uuid7 } from "../protocol/uuid7";
import type {
  ActionName,
  ClientMessage,
  AskAnswerWire,
  ControlInbound,
  QueuedMessageItem,
  ServerMessage,
  ThinkingLevel,
  WireCommand,
  WireImage,
  WireModel,
} from "../protocol/types";
import { RelayClient, type RelayStatus } from "../relay/client";
import {
  listPeers,
  loadIdentity,
  loadSettings,
  saveIdentity,
  savePeer,
  mergeSettings,
  deletePeer,
  prefsFrom,
  settingsPatchForPrefs,
  type PeerRecord,
  type Preferences,
} from "../storage/store";
import {
  addLocalUserMessage,
  applyMessage,
  emptyTranscript,
  failStalePending,
  markAnswered,
  type TranscriptState,
} from "./transcript";
import {
  emptyUiControl,
  isUiControl,
  reduceUiControl,
  type UiControlState,
} from "./ui_control";

const PAIR_TIMEOUT_MS = 15_000;
const HISTORY_LIMIT = 60;

/**
 * How long an optimistic send may sit unanswered before it shows as "not
 * delivered". Mirrors the Flutter app's silent-reap window.
 */
const SEND_REAP_MS = 20_000;
const REAP_INTERVAL_MS = 5_000;

export type SessionPhase =
  | "booting"
  | "unsupported"
  | "ready" /* identity loaded, nothing paired */
  | "pairing"
  | "connecting"
  | "live";

export interface Notice {
  id: string;
  tone: "info" | "warn" | "error";
  text: string;
}

/**
 * A resolved answer for an `extension_ui_request`.
 *
 * The Pi accepts two shapes and this covers both: with a pi-ask `ask` envelope
 * the structured `answers` (option **values**) go back in the envelope; without
 * one, a bare `value` (**label**) is what the Pi maps back to a value itself.
 */
export interface QuestionAnswer {
  /** The request id, echoed verbatim. */
  requestId: string;
  /** Human-readable summary for the resolved transcript line. */
  summary: string;
  /** Present when the prompt carried an `ask` envelope. */
  flowId?: string;
  /** Structured answers keyed by question id (rich path). */
  answers?: Record<string, AskAnswerWire>;
  /** Chosen option label (degraded path). */
  label?: string;
  cancelled?: boolean;
}

/** Room identity the Pi reports over the control channel. */
export interface RoomDescriptor {
  /** Human-readable room name, if the Pi announced one. */
  name?: string;
  /** Working directory the Pi's session runs in. */
  cwd?: string;
}

/** A room (project) a paired Pi has announced over the control channel. */
export interface ProjectRoom {
  roomId: string;
  name?: string;
  cwd?: string;
  model?: string;
  thinking?: ThinkingLevel;
  working?: boolean;
  startedAt?: number;
}

/**
 * One home-screen entry: a room on a paired Pi, with liveness.
 *
 * A "project" is a room — the working directory a Pi session runs in — so a
 * single Pi can expose several. Rooms are keyed by `(epk, roomId)`.
 */
export interface ProjectEntry {
  epk: string;
  peerLabel: string;
  hostname?: string;
  online: boolean;
  roomId: string;
  name?: string;
  cwd?: string;
  model?: string;
  thinking?: ThinkingLevel;
  working?: boolean;
  /** True when this is the session currently connected. */
  active: boolean;
}

export interface PiSession {
  phase: SessionPhase;
  relayStatus: RelayStatus;
  relayDetail?: string;
  relayUrl: string;
  identity?: StoredIdentity;
  peers: PeerRecord[];
  activePeer?: PeerRecord;
  /** Room name + working directory the Pi announced (for the info panel). */
  room: RoomDescriptor;
  /** Every known project (room) across paired Pis, for the home screen. */
  projects: ProjectEntry[];
  transcript: TranscriptState;
  notices: Notice[];
  /** Model name reported by the Pi's room meta (survives before a catalogue load). */
  model?: string;
  /** Structured current model, once `list_models` has answered. */
  currentModel?: WireModel;
  /** Model catalogue from `models_list`. */
  models: WireModel[];
  commands: WireCommand[];
  /** Thinking level the Pi is on, from room meta or a local change. */
  thinking?: ThinkingLevel;
  /** Which typed action is in flight, for spinners. */
  busyAction?: ActionName;
  /** Drafts the Pi is holding while a turn runs. */
  queued: QueuedMessageItem[];
  /** Ephemeral session chrome pushed by one-way extension UI controls. */
  uiControl: UiControlState;
  /** Browser-local preferences (hide tool calls, voice disclosure ack). */
  prefs: Preferences;
  pairFromQr: (raw: string) => Promise<void>;
  selectPeer: (epk: string) => void;
  /** Open a specific room on a paired Pi (the home-screen entry point). */
  openProject: (epk: string, roomId: string) => void;
  forgetPeer: (epk: string) => Promise<void>;
  sendMessage: (text: string, images?: WireImage[]) => void;
  cancelTurn: (targetId: string) => void;
  answerQuestion: (answer: QuestionAnswer) => void;
  /** Fetch the model catalogue (`list_models`). */
  listModels: () => void;
  listCommands: () => void;
  setModel: (model: WireModel) => void;
  setThinking: (level: ThinkingLevel) => void;
  newSession: () => void;
  compact: () => void;
  /** Set or clear the Pi-side draft for this session. */
  setQueued: (text: string) => void;
  /** Persist a preferences patch and reflect it immediately. */
  setPrefs: (patch: Partial<Preferences>) => void;
  resync: () => void;
  setRelayUrl: (url: string) => Promise<void>;
  retry: () => void;
  dismissNotice: (id: string) => void;
}

export function usePiSession(): PiSession {
  const [phase, setPhase] = useState<SessionPhase>("booting");
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("idle");
  const [relayDetail, setRelayDetail] = useState<string | undefined>();
  const [relayUrl, setRelayUrlState] = useState(DEFAULT_RELAY_URL);
  const [identity, setIdentity] = useState<StoredIdentity | undefined>();
  const [peers, setPeers] = useState<PeerRecord[]>([]);
  const [activeEpk, setActiveEpk] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [model, setModelName] = useState<string | undefined>();
  const [models, setModels] = useState<WireModel[]>([]);
  const [commands, setCommands] = useState<WireCommand[]>([]);
  const [currentModel, setCurrentModel] = useState<WireModel | undefined>();
  const [thinking, setThinkingState] = useState<ThinkingLevel | undefined>();
  const [busyAction, setBusyAction] = useState<ActionName | undefined>();
  const [queued, setQueuedState] = useState<QueuedMessageItem[]>([]);
  const [uiControl, setUiControl] = useState<UiControlState>(emptyUiControl);
  const [prefs, setPrefsState] = useState<Preferences>(prefsFrom(undefined));
  const [room, setRoom] = useState<RoomDescriptor>({});
  /** Per-peer liveness, fed by `presence` / `peer_online` / `peer_offline`. */
  const [onlineByPeer, setOnlineByPeer] = useState<Record<string, boolean>>({});
  /** Per-peer room inventory, fed by `rooms` / `room_announced` / `room_ended`. */
  const [roomsByPeer, setRoomsByPeer] = useState<Record<string, ProjectRoom[]>>({});
  /** In-flight request ids, so replies can be matched to what asked. */
  const pendingRef = useRef<{ models?: string; commands?: string; actions: Map<string, ActionName> }>({
    actions: new Map(),
  });
  /** Latest working flag, read by `sendMessage` without re-creating the callback. */
  const workingRef = useRef(false);

  const clientRef = useRef<RelayClient | null>(null);
  const pairingRef = useRef<{
    client: RelayClient;
    resolve: (peer: PeerRecord) => void;
    reject: (err: Error) => void;
  } | null>(null);
  const activePeerRef = useRef<PeerRecord | undefined>(undefined);
  const peersRef = useRef<PeerRecord[]>([]);

  const notice = useCallback((tone: Notice["tone"], text: string) => {
    setNotices((prev) => [...prev.slice(-4), { id: uuid7(), tone, text }]);
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── boot: identity + settings + paired peers ─────────────────────────────

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!(await isEd25519Supported())) {
        if (!cancelled) setPhase("unsupported");
        return;
      }

      let stored = await loadIdentity();
      if (!stored) {
        stored = await generateIdentity();
        await saveIdentity(stored);
      }
      const settings = await loadSettings();
      const paired = await listPeers();

      if (cancelled) return;
      setIdentity(stored);
      if (settings?.relay_url) setRelayUrlState(settings.relay_url);
      setPrefsState(prefsFrom(settings));
      setPeers(paired);

      // Reconnect on open, like the mobile app: the remembered peer if it is
      // still paired, otherwise the only peer there is.
      const remembered = paired.find((p) => p.remote_epk === settings?.last_peer_epk);
      const target = remembered ?? (paired.length === 1 ? paired[0] : undefined);
      if (target) {
        setActiveEpk(target.remote_epk);
        connectToPeer(target, stored, settings?.relay_url ?? DEFAULT_RELAY_URL);
      } else {
        setPhase("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
    // `connectToPeer` is stable (useCallback with stable deps) but defined
    // below; running the boot once is the intent, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── persistent relay client ──────────────────────────────────────────────

  const activePeer = useMemo(
    () => peers.find((p) => p.remote_epk === activeEpk),
    [peers, activeEpk],
  );
  activePeerRef.current = activePeer;
  peersRef.current = peers;

  /**
   * Home-screen model: every known room on every paired Pi.
   *
   * Rooms come from the relay's room registry; a peer we have not heard a room
   * inventory for yet falls back to the room the pairing recorded, so a Pi is
   * always reachable even before it announces.
   */
  const projects = useMemo<ProjectEntry[]>(() => {
    const list: ProjectEntry[] = [];
    for (const peer of peers) {
      const peerLabel =
        peer.nickname ?? peer.session_name ?? peer.hostname ?? peer.remote_epk.slice(0, 12);
      const online = onlineByPeer[peer.remote_epk] ?? peer.remote_epk === activeEpk;
      const announced = roomsByPeer[peer.remote_epk];
      const rooms: ProjectRoom[] = announced?.length
        ? announced
        : [{ roomId: peer.room_id, name: peer.session_name }];
      for (const room of rooms) {
        list.push({
          epk: peer.remote_epk,
          peerLabel,
          hostname: peer.hostname,
          online,
          roomId: room.roomId,
          name: room.name,
          cwd: room.cwd,
          model: room.model,
          thinking: room.thinking,
          working: room.working,
          active: peer.remote_epk === activeEpk && room.roomId === peer.room_id,
        });
      }
    }
    return list;
  }, [peers, roomsByPeer, onlineByPeer, activeEpk]);

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      // A pairing in flight consumes its own reply.
      const pairing = pairingRef.current;
      if (pairing && (message.type === "pair_ok" || message.type === "pair_error")) {
        if (message.type === "pair_ok") {
          pairing.resolve({
            remote_epk: pairing.client.getPeer(),
            session_name: message.session_name,
            relay_url: relayUrl,
            paired_at: new Date().toISOString(),
            room_id: message.room_id,
            hostname: message.hostname,
            harness: message.harness?.name,
            harness_version: message.harness?.version,
          });
        } else {
          pairing.reject(new Error(`${message.code}: ${message.message}`));
        }
        return;
      }

      switch (message.type) {
        case "models_list":
          setModels(message.models);
          if (message.current) {
            setCurrentModel(message.current);
            setModelName(message.current.name);
          }
      pendingRef.current.models = undefined;
      return;
    case "commands_list":
      setCommands(message.commands);
      pendingRef.current.commands = undefined;
      return;
    case "action_ok":
        case "action_error": {
          const pending = pendingRef.current.actions.get(message.in_reply_to);
          pendingRef.current.actions.delete(message.in_reply_to);
          const action = message.action;
          setBusyAction((current) => (current === action ? undefined : current));

          if (message.type === "action_error") {
            notice("error", `${action}: ${message.error}`);
            return;
          }

          // `session_new` wipes the Pi's side; the mirror is re-pulled so the
          // scrollback matches rather than keeping turns the Pi no longer has.
          if (message.action === "session_new") {
            setTranscript(emptyTranscript);
            clientRef.current?.send({ type: "session_sync", id: uuid7(), limit: HISTORY_LIMIT });
          }
          void pending;
          return;
        }

        case "queued_message_state":
          setQueuedState(message.items ?? []);
          return;

        case "session_history":
          setTranscript(applyMessage(emptyTranscript, message));
          return;

        default:
          // One-way display controls (setStatus/setWidget/setTitle/
          // set_editor_text) are ephemeral chrome, not transcript content.
          if (isUiControl(message)) {
            setUiControl((prev) => reduceUiControl(prev, message));
            return;
          }
          break;
      }

      setTranscript((prev) => {
        const next = applyMessage(prev, message);
        // Read by `sendMessage` to decide steer-vs-send without re-creating it.
        workingRef.current = next.working;
        return next;
      });
    },
    [notice, relayUrl],
  );

  const handleControl = useCallback((frame: ControlInbound) => {
    // The auth handshake is answered inside RelayClient; never reaches here.
    if (frame.type === "challenge") return;

    // Liveness for every paired Pi — drives the home-screen presence dots.
    if (frame.type === "presence") {
      setOnlineByPeer((prev) => {
        const next = { ...prev };
        for (const state of frame.states) next[state.peer] = state.online;
        return next;
      });
      return;
    }
    if (frame.type === "peer_online") {
      setOnlineByPeer((prev) => ({ ...prev, [frame.peer]: true }));
      return;
    }
    if (frame.type === "peer_offline") {
      setOnlineByPeer((prev) => ({ ...prev, [frame.peer]: false }));
      return;
    }

    // Room inventory for every paired Pi — drives the home-screen project list.
    if (frame.type === "room_announced") {
      setRoomsByPeer((prev) => {
        const rooms = prev[frame.peer] ?? [];
        const announced: ProjectRoom = {
          roomId: frame.room_id,
          name: frame.name,
          cwd: frame.cwd,
          model: frame.model,
          thinking: frame.thinking,
          startedAt: frame.started_at,
        };
        const index = rooms.findIndex((r) => r.roomId === frame.room_id);
        const merged =
          index >= 0 ? rooms.map((r, i) => (i === index ? { ...r, ...announced } : r)) : [...rooms, announced];
        return { ...prev, [frame.peer]: merged };
      });
    } else if (frame.type === "room_ended") {
      setRoomsByPeer((prev) => {
        const rooms = prev[frame.peer];
        if (!rooms) return prev;
        return { ...prev, [frame.peer]: rooms.filter((r) => r.roomId !== frame.room_id) };
      });
    } else if (frame.type === "room_meta_updated") {
      setRoomsByPeer((prev) => {
        const rooms = prev[frame.peer];
        if (!rooms) return prev;
        return {
          ...prev,
          [frame.peer]: rooms.map((r) =>
            r.roomId === frame.room_id
              ? {
                  ...r,
                  model: frame.meta.model ?? r.model,
                  thinking: frame.meta.thinking ?? r.thinking,
                  working: frame.meta.working ?? r.working,
                }
              : r,
          ),
        };
      });
    } else if (frame.type === "rooms") {
      setRoomsByPeer((prev) => ({
        ...prev,
        [frame.peer]: frame.rooms.map((r) => ({
          roomId: r.room_id,
          name: r.name,
          cwd: r.cwd,
          model: r.model,
          thinking: r.thinking,
          startedAt: r.started_at,
        })),
      }));
    }

    // Everything below is about the *connected* session. Another peer's room
    // frames must not clobber the active model/thinking or the retargeting.
    const active = activePeerRef.current;
    if (!active || frame.peer !== active.remote_epk) return;

    // `room_announced` carries the model/thinking at the top level;
    // `room_meta_updated` nests them under `meta`. A field absent from the
    // patch is left untouched (JSON merge patch), and an explicit null clears.
    if (frame.type === "room_announced") {
      if (frame.model) setModelName(frame.model);
      if (frame.thinking) setThinkingState(frame.thinking);
      if (frame.name || frame.cwd) {
        setRoom((prev) => ({ name: frame.name ?? prev.name, cwd: frame.cwd ?? prev.cwd }));
      }
      return;
    }
    if (frame.type === "room_meta_updated") {
      if (frame.meta.model) setModelName(frame.meta.model);
      if (frame.meta.thinking) setThinkingState(frame.meta.thinking);
      return;
    }
    if (frame.type === "rooms") {
      // Plan/17 discovery: a QR without `rm` makes us address "main". Once the
      // Pi announces its real rooms, retarget and persist.
      const match = frame.rooms.find((r) => r.room_id === active.room_id) ?? frame.rooms[0];
      if (match && match.room_id !== active.room_id) {
        const updated = { ...active, room_id: match.room_id, session_name: match.name ?? active.session_name };
        void savePeer(updated).then(() => {
          setPeers((prev) => prev.map((p) => (p.remote_epk === updated.remote_epk ? updated : p)));
        });
        clientRef.current?.setActiveRoom(match.room_id);
      }
      if (match?.model) setModelName(match.model);
      if (match?.thinking) setThinkingState(match.thinking);
      if (match?.name || match?.cwd) {
        setRoom((prev) => ({ name: match.name ?? prev.name, cwd: match.cwd ?? prev.cwd }));
      }
    }
  }, []);

  const connectToPeer = useCallback(
    (peer: PeerRecord, stored: StoredIdentity, overrideRelayUrl?: string) => {
      clientRef.current?.close();
      setTranscript(emptyTranscript);
      setModelName(undefined);
      setCurrentModel(undefined);
      setThinkingState(undefined);
      setModels([]);
      setQueuedState([]);
      setUiControl(emptyUiControl);
      setBusyAction(undefined);
      setRoom({});
      workingRef.current = false;
      pendingRef.current.actions.clear();

      const client = new RelayClient({
        // The saved relay wins over the peer record only when the user changed
        // it; the record is what the pairing actually used.
        relayUrl: overrideRelayUrl ?? peer.relay_url,
        identity: stored,
        activeRoom: peer.room_id || "main",
        handlers: {
          onStatus: (status, detail) => {
            setRelayStatus(status);
            setRelayDetail(detail);
            setPhase(status === "online" ? "live" : status === "closed" ? "ready" : "connecting");
            // Ask for the session mirror + room inventory every time routing
            // comes up — including after a reconnect, so the scrollback is not
            // left stale. Sending earlier would be dropped: the socket is
            // still CONNECTING until this point.
            if (status === "online") {
              const epks = Array.from(
                new Set([...peersRef.current.map((p) => p.remote_epk), peer.remote_epk]),
              );
              client.send({ type: "session_sync", id: uuid7(), limit: HISTORY_LIMIT });
              // Presence + room inventory for *every* paired Pi, so the home
              // screen can list projects beyond the one we are connected to.
              client.sendControl({ type: "subscribe_presence", peers: epks });
              client.sendControl({ type: "presence_check", peers: epks });
              client.sendControl({ type: "subscribe_rooms", peers: epks });
              client.sendControl({ type: "rooms_check", peers: epks });
              // Re-read the catalogue so the picker shows the Pi's real current
              // model after a reconnect.
              pendingRef.current.models = uuid7();
              client.send({ type: "list_models", id: pendingRef.current.models });
              pendingRef.current.commands = uuid7();
              client.send({ type: "list_commands", id: pendingRef.current.commands });
            }
          },
          onMessage: handleMessage,
          onControl: handleControl,
          onNotice: (text) => notice("warn", text),
        },
      });
      client.setPeer(peer.remote_epk);
      clientRef.current = client;
      client.start();
    },
    [handleControl, handleMessage, notice],
  );

  const selectPeer = useCallback(
    (epk: string) => {
      setActiveEpk(epk);
      // Remembered so a reload (or an installed-PWA launch) reconnects instead
      // of stopping at the pairing screen.
      void mergeSettings({ last_peer_epk: epk });
      const peer = peers.find((p) => p.remote_epk === epk);
      if (peer && identity) connectToPeer(peer, identity);
    },
    [connectToPeer, identity, peers],
  );

  const openProject = useCallback(
    (epk: string, roomId: string) => {
      const peer = peers.find((p) => p.remote_epk === epk);
      if (!peer) return;
      // Persist the chosen room so reconnects (and the boot auto-reconnect)
      // land on this project rather than whatever was selected before.
      const roomName = roomsByPeer[epk]?.find((r) => r.roomId === roomId)?.name;
      const updated: PeerRecord = {
        ...peer,
        room_id: roomId,
        session_name: roomName ?? peer.session_name,
      };
      void savePeer(updated).then(() => {
        setPeers((prev) => prev.map((p) => (p.remote_epk === epk ? updated : p)));
      });
      setActiveEpk(epk);
      void mergeSettings({ last_peer_epk: epk });
      if (identity) connectToPeer(updated, identity);
    },
    [connectToPeer, identity, peers, roomsByPeer],
  );

  // Tear the socket down on unmount.
  useEffect(() => () => clientRef.current?.close(), []);

  // Reap optimistic sends the Pi never acknowledged, so a silently dropped
  // message stops claiming to be "sending…". Only runs while live.
  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => {
      setTranscript((prev) => failStalePending(prev, Date.now(), SEND_REAP_MS));
    }, REAP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase]);

  // ── pairing ──────────────────────────────────────────────────────────────

  const pairFromQr = useCallback(
    async (raw: string) => {
      if (!identity) throw new Error("Identity is not ready yet.");
      const qr = parseQrPayload(raw);

      // The app refuses a QR that points at a different relay than the one it
      // is configured for — pairing would silently target the wrong endpoint.
      if (qr.relayUrl && toWsRelayUrl(qr.relayUrl) !== toWsRelayUrl(relayUrl)) {
        throw new Error(
          `This QR points at ${qr.relayUrl}, but the relay is set to ${relayUrl}. ` +
            "Update the relay in settings or generate a new QR.",
        );
      }

      setPhase("pairing");

      // A fresh client per attempt: pairing needs the QR's peer id and room.
      const client = new RelayClient({
        relayUrl,
        identity,
        activeRoom: qr.roomId ?? "main",
        handlers: {
          onStatus: (status, detail) => {
            setRelayStatus(status);
            setRelayDetail(detail);
          },
          onMessage: handleMessage,
          onControl: () => {},
          onNotice: (text) => notice("warn", text),
        },
      });
      client.setPeer(qr.epk);

      let resolvePair: ((peer: PeerRecord) => void) | undefined;
      let rejectPair: ((err: Error) => void) | undefined;
      const result = new Promise<PeerRecord>((resolve, reject) => {
        resolvePair = resolve;
        rejectPair = reject;
      });
      // The pair promise may be rejected before we get to await it (a failed
      // connect, a timeout during the handshake), so keep it handled.
      const handled = result.catch(() => {});
      pairingRef.current = { client, resolve: resolvePair!, reject: rejectPair! };
      const timer = setTimeout(() => {
        if (pairingRef.current?.client === client) {
          pairingRef.current = null;
          rejectPair!(
            new Error(
              "The Pi did not answer in time. Check that it is running and on the same relay, " +
                "then generate a fresh QR (tokens expire after 60s).",
            ),
          );
        }
      }, PAIR_TIMEOUT_MS);

      try {
        client.start();
        // Wait for auth before sending: a socket that is still CONNECTING
        // refuses `send`, so the pair_request would be dropped and the only
        // symptom would be a timeout.
        await client.whenOnline(PAIR_TIMEOUT_MS);
        client.send({
          type: "pair_request",
          id: uuid7(),
          token: qr.token,
          device_name: deviceName(),
        });

        const peer = await result;
        pairingRef.current = null;
        client.close();

        const saved: PeerRecord = { ...peer, session_name: peer.session_name || qr.sessionName };
        await savePeer(saved);
        setPeers((prev) => [...prev.filter((p) => p.remote_epk !== saved.remote_epk), saved]);
        setActiveEpk(saved.remote_epk);
        connectToPeer(saved, identity);
      } catch (err) {
        pairingRef.current = null;
        client.close();
        setPhase("ready");
        setRelayStatus("idle");
        throw err instanceof Error
          ? err
          : new Error("Could not reach the relay. Check the relay URL and your connection.");
      } finally {
        clearTimeout(timer);
        // Settle the pair promise so a bail-out above cannot leave it dangling.
        await handled;
      }
    },
    [connectToPeer, handleMessage, identity, notice, relayUrl],
  );

  const forgetPeer = useCallback(
    async (epk: string) => {
      await deletePeer(epk);
      setPeers((prev) => prev.filter((p) => p.remote_epk !== epk));
      setRoomsByPeer((prev) => {
        if (!(epk in prev)) return prev;
        const next = { ...prev };
        delete next[epk];
        return next;
      });
      setOnlineByPeer((prev) => {
        if (!(epk in prev)) return prev;
        const next = { ...prev };
        delete next[epk];
        return next;
      });
      if (activeEpk === epk) {
        clientRef.current?.close();
        clientRef.current = null;
        setActiveEpk(undefined);
        setTranscript(emptyTranscript);
        setPhase("ready");
      }
    },
    [activeEpk],
  );

  // ── actions ──────────────────────────────────────────────────────────────

  /** Send a typed action and remember it so the reply can clear the spinner. */
  const sendAction = useCallback(
    (action: ActionName, message: ClientMessage) => {
      const client = clientRef.current;
      if (!client) {
        notice("error", `Not connected — cannot run ${action}.`);
        return;
      }
      pendingRef.current.actions.set(message.id, action);
      setBusyAction(action);
      client.send(message);
    },
    [notice],
  );

  const sendMessage = useCallback(
    (text: string, images?: WireImage[]) => {
      const trimmed = text.trim();
      if (!trimmed && !images?.length) return;
      const client = clientRef.current;
      if (!client) {
        notice("error", "Not connected — cannot send.");
        return;
      }
      const id = uuid7();
      // While a turn is running, the message steers it instead of starting a
      // second turn (plan/43 app steering). The Pi answers with `steer_consumed`
      // when it has folded the text into the live turn.
      const steering = workingRef.current;
      // Optimistic echo: the Pi broadcasts the same id back to every owner, and
      // the reducer treats that echo as confirmation, not a duplicate.
      setTranscript((prev) => addLocalUserMessage(prev, id, trimmed, { steering, images }));
      client.send({
        type: "user_message",
        id,
        text: trimmed,
        images: images?.length ? images : undefined,
        streaming_behavior: steering ? "steer" : undefined,
      });
    },
    [notice],
  );

  const cancelTurn = useCallback((targetId: string) => {
    clientRef.current?.send({ type: "cancel", id: uuid7(), target_id: targetId });
  }, []);

  const answerQuestion = useCallback(
    (answer: QuestionAnswer) => {
      const client = clientRef.current;
      if (!client) return;

      // Cancel wins over any answer: it is an explicit dismissal.
      if (answer.cancelled) {
        client.send(
          answer.flowId
            ? { type: "extension_ui_response", id: answer.requestId, ask: { flow_id: answer.flowId, kind: "cancel" } }
            : { type: "extension_ui_response", id: answer.requestId, cancelled: true },
        );
        setTranscript((prev) => markAnswered(prev, answer.requestId, answer.summary, true));
        return;
      }

      if (answer.flowId && answer.answers) {
        // Rich path: the structured answers supersede the value/confirmed
        // discriminators, and option *values* are what pi-ask expects.
        client.send({
          type: "extension_ui_response",
          id: answer.requestId,
          ask: {
            flow_id: answer.flowId,
            kind: "answer",
            mode: "submit",
            answers: answer.answers,
          },
        });
      } else {
        // Degraded path: the Pi maps this label back to an option value.
        client.send({
          type: "extension_ui_response",
          id: answer.requestId,
          value: answer.label ?? answer.summary,
        });
      }
      setTranscript((prev) => markAnswered(prev, answer.requestId, answer.summary));
    },
    [],
  );

  const listModels = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const id = uuid7();
    pendingRef.current.models = id;
    client.send({ type: "list_models", id });
  }, []);

  const listCommands = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const id = uuid7();
    pendingRef.current.commands = id;
    client.send({ type: "list_commands", id });
  }, []);

  const setModel = useCallback(
    (next: WireModel) => {
      sendAction("model_set", {
        type: "model_set",
        id: uuid7(),
        provider: next.provider,
        model_id: next.id,
      });
      // Optimistic: the room meta broadcast confirms it shortly after.
      setCurrentModel(next);
      setModelName(next.name);
    },
    [sendAction],
  );

  const setThinking = useCallback(
    (level: ThinkingLevel) => {
      sendAction("thinking_set", { type: "thinking_set", id: uuid7(), level });
      setThinkingState(level);
    },
    [sendAction],
  );

  const newSession = useCallback(() => {
    sendAction("session_new", { type: "session_new", id: uuid7() });
  }, [sendAction]);

  const compact = useCallback(() => {
    sendAction("session_compact", { type: "session_compact", id: uuid7() });
  }, [sendAction]);

  const setQueued = useCallback((text: string) => {
    const client = clientRef.current;
    if (!client) return;
    // The Pi echoes the resulting queue back via `queued_message_state`, so the
    // local list is never hand-maintained.
    client.send({ type: "queued_message_set", id: uuid7(), text });
  }, []);

  const resync = useCallback(() => {
    clientRef.current?.send({ type: "session_sync", id: uuid7(), limit: HISTORY_LIMIT });
  }, []);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    // Optimistic local update; the IndexedDB write is fire-and-forget.
    setPrefsState((prev) => ({ ...prev, ...patch }));
    void mergeSettings(settingsPatchForPrefs(patch));
  }, []);

  const setRelayUrl = useCallback(
    async (url: string) => {
      await mergeSettings({ relay_url: url });
      setRelayUrlState(url);
      const peer = activePeerRef.current;
      if (peer && identity) connectToPeer({ ...peer, relay_url: url }, identity);
    },
    [connectToPeer, identity],
  );

  const retry = useCallback(() => {
    const peer = activePeerRef.current;
    if (!peer || !identity) return;
    connectToPeer(peer, identity);
  }, [connectToPeer, identity]);

  return {
    phase,
    relayStatus,
    relayDetail,
    relayUrl,
    identity,
    peers,
    activePeer,
    room,
    projects,
    transcript,
    notices,
    model,
    currentModel,
    models,
    commands,
    thinking,
    busyAction,
    queued,
    uiControl,
    prefs,
    pairFromQr,
    selectPeer,
    openProject,
    forgetPeer,
    sendMessage,
    cancelTurn,
    answerQuestion,
    listModels,
    listCommands,
    setModel,
    setThinking,
    newSession,
    compact,
    setQueued,
    setPrefs,
    resync,
    setRelayUrl,
    retry,
    dismissNotice,
  };
}

/** Stable per-device label; the Pi shows it in its paired-peers list. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "Browser";
  return `Web · ${platform}`;
}

export { publicKeyB64Of };
