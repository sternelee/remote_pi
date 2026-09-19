#!/usr/bin/env node
/**
 * CLI harness: run a fake Pi peer and print a pairing link to paste into the
 * web client.
 *
 * The protocol logic lives in `fake-pi-peer.mjs` so the integration test can
 * drive the same peer in-process. This file is only the CLI wrapper.
 *
 * Usage:
 *   node tools/fake-pi.mjs            # prints a remotepi:// link
 *   ASK=0 node tools/fake-pi.mjs      # skip the interactive prompt
 *   RELAY=ws://localhost:3000 node tools/fake-pi.mjs
 */

import { startFakePi } from "./fake-pi-peer.mjs";

const relayUrl = process.env.RELAY ?? "wss://relay-rp1.jacobmoura.work";
const sessionName = process.env.SESSION_NAME ?? "fake-pi · demo-session";
const ask = process.env.ASK !== "0";

const log = (message) => console.log(`[fake-pi] ${message}`);

const peer = await startFakePi({ relayUrl, sessionName, ask, log });

log(`connecting → ${relayUrl}`);

// `startFakePi` resolves only once the relay accepted auth, so the printed link
// is usable the moment it appears.

console.log("");
console.log("  Paste this into the web client:");
console.log("");
console.log(`  ${peer.link}`);
console.log("");
console.log(`  epk=${peer.epk}`);
console.log(`  room=${peer.room}`);
console.log("");

process.on("SIGINT", () => {
  peer.close();
  process.exit(0);
});
