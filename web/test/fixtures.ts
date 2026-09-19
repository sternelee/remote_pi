/**
 * Reads the shared protocol fixtures.
 *
 * `PROTOCOL.md` fixes `.orchestration/contracts/fixtures/*.jsonl` as the single
 * set of vectors that the TS, Dart and Rust implementations all decode, so the
 * web client is tested against the same bytes as the app and the extension
 * rather than a private copy that can drift.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = fileURLToPath(
  new URL("../../.orchestration/contracts/fixtures/", import.meta.url),
);

/** Every fixture, keyed by file name without the extension. */
export function allFixtures(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const file of readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".jsonl"))) {
    out[file.replace(/\.jsonl$/, "")] = readFixture(file);
  }
  return out;
}

/** One fixture file, one parsed JSON object per JSONL line. */
export function readFixture(name: string): unknown[] {
  const text = readFileSync(`${FIXTURE_DIR}${name}${name.endsWith(".jsonl") ? "" : ".jsonl"}`, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/** First line of a fixture, typed by the caller. */
export function fixture<T = unknown>(name: string): T {
  const lines = readFixture(name);
  if (lines.length === 0) throw new Error(`fixture ${name} is empty`);
  return lines[0] as T;
}

export const fixtureNames: string[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".jsonl"))
  .map((f) => f.replace(/\.jsonl$/, ""))
  .sort();
