# Lervo ADE delivery

Status: `active`
As of: 2026-11-23

This roadmap delivers [ADR-0613](../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md), the Lervo ADE that the owner requested to replace Orca. The ADE serves the Surface outcome of the [core outcomes](../product/vision/core-outcomes.md), and its completion follows their completion rule. The [ADE convention](../foundation/ade-convention.md), the [sessions specification](../specifications/execution/product-surfaces/ade-sessions.md), and the [visual language](../specifications/execution/product-surfaces/ade-visual-language.md) govern every increment.

## How increments land

- Each increment lands as its own pull request and leaves `main` releasable.
- An increment is done when its completion check passes on the owner's Mac and in the ADE workflow on Linux CI. WSL shares the Linux build and runtime, so the Linux run stands for it.
- An increment that changes WSL-specific behavior, such as the WSLg window or the transport between a Windows interface and a WSL session host, also passes its check in WSL, with the owner's permission for that run.
- Continuous integration for the ADE runs on Linux only, filtered to the ADE paths and the protocol schema. Desktop bundles for macOS and Windows build at release.

## S1: instruction-first workspaces with the native conversation

| Increment                      | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Done when                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1.1 Toolchain and gates       | `apps/ade/` holds the React interface (`@lervo/ade`, commit scope `ade`), the Tauri shell crate, and the session-host binary in one Cargo workspace with a pinned toolchain. `pnpm ade:check` runs the interface build, `rustfmt`, `clippy` with `-D warnings`, the Rust tests, and `cargo deny`. ESLint covers the interface with React Hooks, `jsx-a11y`, and the literal-text rule. The package boundary checker covers `@lervo/ade`. One path-filtered Linux workflow runs `pnpm ade:check` with a Cargo cache. | The Tauri shell and the session-host binary build, and every gate passes on both hosts.                                                                                    |
| S1.2 Protocol                  | The session-host protocol v1 is a JSON Schema in `@lervo/session-host-contract`: the handshake with version negotiation and a token, the control and terminal frames, sequenced deltas, session lifecycle, conversation items and ranges, application commands, and status. TypeScript types come from it through `json-schema-to-ts`, and Rust types through `typify`; both sides validate against the same document.                                                                                              | Both sides accept, round-trip, and reject the same fixtures in contract tests.                                                                                             |
| S1.3a Session domain and index | `lervo-session-core`: the session status machine, sequences, the bounded scrollback, item positions and pages, a byte-bounded cache, and the client output budget, all without I/O. `lervo-session-store`: append-only conversation segment files with torn-record recovery.                                                                                                                                                                                                                                        | Unit and store tests pass.                                                                                                                                                 |
| S1.3b Session host process     | The owner-only local transport with the token and the handshake, session actors that wire the domain to the PTY and structured-stream process adapters, the `serve` command, and one session host per OS user that a client can start at any time.                                                                                                                                                                                                                                                                  | Contract tests pass over a real socket, and the harness meets the idle-CPU and per-session memory budgets.                                                                 |
| S1.4a Hosted launches          | The hosted-session adapter contract with capability declarations and common checks, Claude Code and Codex CLI launch preparation, branch provisioning in the Git workspace host, `lervo workspace start` with stage rollback, `lervo workspace open`, and the launch descriptor record.                                                                                                                                                                                                                             | Core tests cover every success and failure meaning, and `lervo workspace start` creates a worktree, a branch, a workstream, and a Claude Code launch in a test repository. |
| S1.4b Core link and decoding   | The resident Lervo application process that the session host starts and reaches over its standard streams, application commands through it, and decoding of Claude Code's structured stream into common conversation events in the Claude adapter.                                                                                                                                                                                                                                                                  | A hosted Claude Code session starts from an instruction in a test repository, and its streamed messages and tool activity reach the session host.                          |
| S1.4c Launch events and hooks  | The session-scoped settings file with Lervo's hook handlers, and the events `application.workspace.started`, `terminal.session.launch_prepared`, `terminal.session.launched`, and `terminal.session.ended` under a new event schema version.                                                                                                                                                                                                                                                                        | A hosted launch records `launch_prepared` and `launched` with the same session ID, and the user's Claude Code settings files keep their bytes.                             |
| S1.5 Interface                 | The Tauri shell with the native window material, the token file with generated CSS and terminal theme, the `en` message catalog, the start screen, the workspace list, the native conversation with virtualization and frame-bound streaming, the CLI conversation fallback, notifications, and restarting the session host when it cannot be reached.                                                                                                                                                              | The S1 verification items of ADR-0613 pass.                                                                                                                                |
| S1.6 Measurement               | The performance harness scenarios, the recorded baselines, and the soak run.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Each budget meets its target or carries a reviewed revision.                                                                                                               |

### S1.1 measurements

Measured on the owner's Mac (Apple M5, 10 cores) on 2026-11-23:

| Step                                                | Time  |
| --------------------------------------------------- | ----- |
| Interface type check and build                      | 3 s   |
| First Rust build, including downloads of 434 crates | 32 s  |
| First `clippy` run                                  | 28 s  |
| Rust tests                                          | 2 s   |
| Rust rebuild after a one-file change                | 0.2 s |
| `cargo deny check`                                  | 3 s   |
| One-time `cargo-deny` installation                  | 58 s  |

The first ADE workflow run on Linux CI, without a Cargo cache, took 2 min 46 s on 2026-11-23: 25 s for the webview packages, 8 s for the toolchain, and 1 min 44 s for `pnpm ade:check`. S1.1 is complete: its checks passed on the Mac and on Linux CI.

### S1.3b measurements

`cargo run --release -p lervo-session-host --example idle_sessions` serves on a temporary socket, opens ten CLI and ten native sessions whose providers wait for input, and measures the process for 60 seconds. Three runs on the owner's Mac on 2026-11-23 gave:

| Measurement                                | Result             | Budget                          |
| ------------------------------------------ | ------------------ | ------------------------------- |
| Session host CPU with twenty idle sessions | 0 to 10 ms in 60 s | under 0.2% of one core (120 ms) |
| Session host memory per idle session       | at most 52 KiB     | at most 5 MB                    |
| Session host idle memory, with one client  | 4.0 to 7.3 MiB     | 30 MB                           |
| Session host binary, release profile       | 4.6 MiB            | within the 20 MB installed size |

Resident memory on macOS moves with memory compression, so the runs differ; every run stayed far below its budget. S1.6 adds the Linux and WSL runs and a steadier memory measure to the harness.

### S1.4 split

The core had no resident application endpoint, no hosted launch path, and no worktree creation on a new branch, so S1.4 was split into three increments on 2026-11-23. S1.4a prepares launches through one-shot commands. S1.4b adds the resident process, which ADR-0613 requires so that no action pays for a Node start, and moves stream decoding there. S1.4c records the launch events once a new event schema version can carry them.

## S2 and S3

ADR-0613 defines S2 (hosted evidence and Lervo tools) and S3 (distribution). Their increments are defined when S1 completes, from what S1 measured.

## Open items

- Before public distribution, the publisher accepts Anthropic's Commercial Terms of Service and checks OpenAI's terms for the Codex CLI.
- Component primitives are chosen in S1.5 against the convention's size and accessibility rules.
