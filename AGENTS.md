# AGENTS.md — Remote Pi

Monorepo with six independently built subprojects plus planning docs. There is **no
root task runner** (no root `package.json`, `Makefile`, or `justfile`): every build,
test, and lint command runs from the subproject directory.

Authoritative docs — read the relevant one before editing a package:

- [`CLAUDE.md`](./CLAUDE.md) — workspace layout and the cmux/Cockpit orchestration flow
- Per-project `CLAUDE.md` (`app/`, `cockpit/`, `pi-extension/`, `relay/`, `site/`) and the
  layer/feature docs under `app/lib/*/CLAUDE.md` and `cockpit/lib/app/{,core/,core/terminal/}CLAUDE.md`
- [`web/README.md`](./web/README.md) — the browser PWA client: architecture, what is and is not
  implemented, and the brainless component provenance
- [`PROTOCOL.md`](./PROTOCOL.md) — canonical wire protocol, identities, ACK, cross-PC routing
- [`plan/00-decisions.md`](./plan/00-decisions.md) — closed architectural decisions; do not
  revisit without explicit discussion

## Package boundaries

| Path | Stack | Notes |
|---|---|---|
| `app/` | Flutter (iOS/Android) | Mobile client. Layered `lib/{config,domain,data,routing,ui}`; `provider` + `auto_injector`, `ViewModel` + `Result<T,E>`. |
| `cockpit/` | Flutter desktop | Feature-sliced `lib/app/<feature>/{domain,data,ui}`. Bundles non-Dart toolchains (see prerequisites). |
| `cockpit/cli/` | Rust crate `cockpit-cli` | Own Cargo project; binary is named `cockpit` and also serves the Claude Code hook. |
| `cockpit/packages/*` | Dart packages | `cockpit_core`, `cockpit_engine`, `cockpit_protocol`, `cockpit_remote`, `cockpit_server`, `cockpit_keepawake` — each with its own pubspec and tests. |
| `cockpit/plugins/cockpit_pty/` | Dart + native FFI | Absorbed `kyroon_pty` fork, unpublished. |
| `pi-extension/` | Node 20+ / TypeScript ESM | Published to npm as `remote-pi`; `dist/` is the package entry. |
| `relay/` | Rust + axum | WebSocket relay + signed-membership SQLite store. |
| `site/` | Next.js 16 | Presentational only; no API routes. |
| `web/` | vinext (Next.js API on Vite) + Cloudflare Workers | Browser PWA client. Pairs with a Pi over the relay and renders the session. See [`web/README.md`](./web/README.md). |
| `rp-s3/` | Rust + axum | Download/manifest server; `PUT /upload` takes manifests only. |
| `plan/`, `review/` | Markdown | Numbered plans and manual smoke scripts. |
| `.orchestration/` | Markdown / JSONL | Shared contracts (read-only) + task results (ephemeral). |
| `scripts/` | Bash | cmux/Cockpit dispatch and docker build helpers. |

## Verification commands

Run from the listed directory. Prefer the focused form (single test file) while iterating.

| Project | Commands |
|---|---|
| `app/` | `flutter pub get` · `flutter analyze` · `flutter test [test/<file>_test.dart]` · `dart format .` |
| `cockpit/` | `flutter pub get` · `flutter analyze` · `flutter test [test/<file>_test.dart]` · `dart format .` · `dart run slang` |
| `cockpit/cli/` | `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test` |
| `cockpit/packages/<name>/` | `dart pub get` · `dart test` |
| `pi-extension/` | `pnpm install` · `pnpm typecheck` · `pnpm test` · `pnpm build` |
| `relay/` | `cargo test` · `cargo clippy -- -D warnings` · `cargo fmt` · `RUST_LOG=info cargo run` |
| `rp-s3/` | `cargo build --release` (crate has no tests) |
| `site/` | `pnpm install` · `pnpm lint` · `pnpm build` |
| `web/` | `pnpm install` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm dev` · `pnpm start` |

Three deviations worth knowing:

- `cockpit/analysis_options.yaml` excludes `packages/**` and `tool/wave*/**` from
  `flutter analyze`, so run `dart analyze` / `dart test` inside each
  `cockpit/packages/<name>/` when you touch one.
- `cockpit/dart_test.yaml` skips the `preview` tag by default (golden/visual tests that
  are host-dependent). Generate them explicitly with
  `flutter test --tags preview --run-skipped --update-goldens`.
- `web/` has two servers and they are easy to confuse. `pnpm dev` (vinext, :3000) is the
  dev server; `pnpm start` serves the **built** Worker via `wrangler dev` on :8787. After
  `pnpm build` the running `pnpm start` process must be restarted — it keeps serving the
  previous build's HTML, whose hashed chunks no longer exist, so the page silently never
  hydrates (it sits on "Loading identity…"). Note that `pkill -f "wrangler dev"` does
  **not** match it; the process command is `…/wrangler.js dev`.

CI exists only for `.github/workflows/{app-release,cockpit-release,cockpit-server-release,cockpit-cli}.yml`.
`relay/`, `pi-extension/`, `site/`, `rp-s3/` and `web/` have no workflow — run their checks locally.

## Prerequisites beyond the language SDK

- **cockpit desktop build**: Rust (`cargo`, resolved from `PATH` then `~/.cargo/bin`) and
  **Zig 0.16.0** — `cockpit/pubspec.yaml` sets `libghostty.source: compile`, so a missing or
  older Zig fails before the app compiles. Also `rustup target add aarch64-unknown-linux-gnu`
  once, for the embedded Linux-arm64 server/CLI bundle.
- **Flutter versions are pinned in CI**, not in a version manager: cockpit `3.47.3`
  (`cockpit-release.yml`), app `3.44.4` (`app-release.yml`). `cockpit/pubspec.yaml` itself
  requires Flutter `>=3.44.0` / Dart `^3.12.0`; `app/pubspec.yaml` requires Dart `^3.11.5`.
- **pnpm, not npm or yarn**, for `pi-extension/`, `site/` and `web/`.

## Generated files (committed — never hand-edit)

- `cockpit/lib/i18n/strings*.g.dart` — produced by `dart run slang` from
  `cockpit/lib/i18n/*.i18n.json` (config `cockpit/slang.yaml`). Re-run and commit together
  whenever an `*.i18n.json` changes.
- `cockpit/lib/app/core/ui/file_icons/file_icon_map.g.dart`.
- `cockpit/test/**/*.mocks.dart` — checked in; there is no `build_runner` step.
- `pi-extension/dist/` — `tsc` output backing `main`/`bin`; gitignored, produced by `pnpm build`.
- `web/components/brainless/**` — vendored verbatim from the
  [brainless registry](https://brainless.swerdlow.dev/components). Edit them only
  deliberately: a local change silently diverges from upstream. Re-fetch with
  `curl -fsSL https://brainless.swerdlow.dev/r/<name>.json` and copy `files[].content`.

Gitignored build output: `build/`, `.dart_tool/`, `target/`, `dist/`, `.next/`, `node_modules/`.

## Protected areas

- `.orchestration/contracts/` — read-only shared contracts, including the
  `fixtures/*.jsonl` wire fixtures. Contract changes arrive as explicit tasks, never as a
  side effect of another change.
- `.orchestration/results/*` — ephemeral per-task reports; only `.gitkeep` and a few
  pre-existing files are tracked.
- `.cockpit/tasks.json` is versioned; every other file under `.cockpit/` is ignored
  (worktrees, local state).
- The root `.gitignore` ignores **all dotfiles** except `.github/`. A new root-level
  dotfile or dotted directory stays untracked until an explicit `!` rule is added.

## Conventions not enforced by tooling

- **Orchestrated mode**: a prompt starting with `[ORCH:<task-id>]` activates
  [`.orchestration/INSTRUCTIONS.md`](./.orchestration/INSTRUCTIONS.md) — work only inside your
  own subproject cwd, never run `git commit`/`git push`, and end by writing
  `.orchestration/results/<task-id>.md` containing a `**Status**:` line (scripts poll that file).
- **cockpit i18n**: no user-facing string literals. `en` (base), `pt-BR`, and `es` must keep
  identical key trees, consumed via `context.t` — the global `t` compiles but does not rebuild
  on locale change. `data/` and ViewModels return typed errors; the UI edge translates them
  (`Result<T, String>` with a ready-made sentence is an anti-pattern in new flows).
- **cockpit layering**: a feature may import `core/`, never another feature; `core/` imports no
  feature. `<feature>_module.dart` is the only file declaring that feature's routes and binds.
- **app layering**: `ui → domain ← data`, with `config/` wiring bindings. Never touch
  `BuildContext` inside `.then/.onSuccess/.flatMap/.whenComplete`; convert to `await` plus
  `if (!mounted) return;` — `use_build_context_synchronously` does not catch chained callbacks.
- **pi-extension is ESM-only** (`module: nodenext`): relative imports need the `.js` extension
  even from `.ts` sources.
- **relay**: use `tracing`, never `println!`; no `unwrap()`/`expect()` on production paths.
- **site**: server components by default, English only, no analytics or tracking.

## Version and release coupling (CI fails on mismatch)

- Tag `app-v*` must equal `app/pubspec.yaml` `version`.
- Tag `cockpit-v*` must equal `cockpit/pubspec.yaml` `version` **including the `+n` build
  number**, and the first `## ` section of `cockpit/CHANGELOG.md` must match that version —
  it is the text Sparkle shows in the update prompt.
- Tag `cockpit-server-v*` must equal the same `cockpit/pubspec.yaml` version: the server and
  the app ship as one version.
- Packaging/release runbook: `cockpit/packaging/README.md`. Image deploys:
  `relay/push-docker.sh`, `site/push-docker.sh`, `rp-s3/push-docker.sh`.

## Security and data handling

- `relay/` must never log or persist message payloads, key material, or signatures. Its SQLite
  database stores only Owner-signed membership metadata. Payloads are **not** end-to-end
  encrypted today; the exact trust boundary is in [`relay/README.md`](./relay/README.md).
- `PROTOCOL.md` is canonical for envelope/identity/ACK/cross-PC routing; the fixtures under
  `.orchestration/contracts/` are the shared vectors for the implementations.
- Never read or copy credentials. CI secrets (Android keystore + `key.properties`, Apple API
  key, `SPARKLE_PRIVATE_KEY`, `RP_S3_UPLOAD_TOKEN`) live only in GitHub Actions. Machine-local
  state (`~/.pi/remote/`, any `.pi/`, `.cockpit/` except `tasks.json`) is gitignored — do not
  commit it.
- `pi-extension` keeps its Ed25519 identity in the OS keyring; headless Linux without D-Bus
  falls back to `~/.pi/remote/identity.json` (`chmod 0600`).

## Completion criteria

- Flutter change: `flutter analyze` and `flutter test` clean in the touched project, plus
  `dart test` in any touched `cockpit/packages/<name>/`.
- cockpit i18n change: `dart run slang` re-run, generated files committed in the same change.
- pi-extension: `pnpm typecheck && pnpm test` clean; run `pnpm build` when the change affects
  runtime output.
- Rust (`relay/`, `rp-s3/`, `cockpit/cli/`): `cargo clippy -- -D warnings` clean and
  `cargo test` green where the crate has tests.
- site: `pnpm lint && pnpm build` clean.
- web: `pnpm typecheck && pnpm test` clean. `pnpm test` is offline; `PI_LIVE=1 pnpm test`
  additionally drives the client against a fake Pi peer over the real relay, and
  `PI_PAIR_LINK='remotepi://pair?…'` against a real one.
- Release-touching change: version and `CHANGELOG.md` updated per the coupling rules above.
