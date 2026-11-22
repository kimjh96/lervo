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

| Increment                       | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Done when                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| S1.1 Toolchain and gates        | `apps/ade/` holds the React interface (`@lervo/ade`, commit scope `ade`), the Tauri shell crate, and the session-host binary in one Cargo workspace with a pinned toolchain. `pnpm ade:check` runs the interface build, `rustfmt`, `clippy` with `-D warnings`, the Rust tests, and `cargo deny`. ESLint covers the interface with React Hooks, `jsx-a11y`, and the literal-text rule. The package boundary checker covers `@lervo/ade`. One path-filtered Linux workflow runs `pnpm ade:check` with a Cargo cache. | The Tauri shell and the session-host binary build, and every gate passes on both hosts.                                               |
| S1.2 Protocol                   | The session-host protocol v1 is a JSON Schema in `@lervo/session-host-contract`: the handshake with version negotiation and a token, the control and terminal frames, sequenced deltas, session lifecycle, conversation items and ranges, application commands, and status. TypeScript types come from it through `json-schema-to-ts`, and Rust types through `typify`; both sides validate against the same document.                                                                                              | Both sides accept, round-trip, and reject the same fixtures in contract tests.                                                        |
| S1.3a Session domain and index  | `lervo-session-core`: the session status machine, sequences, the bounded scrollback, item positions and pages, a byte-bounded cache, and the client output budget, all without I/O. `lervo-session-store`: append-only conversation segment files with torn-record recovery.                                                                                                                                                                                                                                        | Unit and store tests pass.                                                                                                            |
| S1.3b Session host process      | The owner-only local transport with the token and the handshake, session actors that wire the domain to the PTY and structured-stream process adapters, the `serve` command, and restart by the client.                                                                                                                                                                                                                                                                                                             | Contract tests pass over a real socket, and the harness meets the idle-CPU and per-session memory budgets.                            |
| S1.4 Core commands and adapters | `lervo workspace start`, the resident application endpoint, hosted launch descriptors and capability declarations for Claude Code and the Codex CLI, the launch events, and decoding of structured streams into common conversation events.                                                                                                                                                                                                                                                                         | Core tests cover every success and failure meaning, and a hosted Claude Code session starts from an instruction in a test repository. |
| S1.5 Interface                  | The Tauri shell with the native window material, the token file with generated CSS and terminal theme, the `en` message catalog, the start screen, the workspace list, the native conversation with virtualization and frame-bound streaming, the CLI conversation fallback, and notifications.                                                                                                                                                                                                                     | The S1 verification items of ADR-0613 pass.                                                                                           |
| S1.6 Measurement                | The performance harness scenarios, the recorded baselines, and the soak run.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Each budget meets its target or carries a reviewed revision.                                                                          |

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

## S2 and S3

ADR-0613 defines S2 (hosted evidence and Lervo tools) and S3 (distribution). Their increments are defined when S1 completes, from what S1 measured.

## Open items

- Before public distribution, the publisher accepts Anthropic's Commercial Terms of Service and checks OpenAI's terms for the Codex CLI.
- Component primitives are chosen in S1.5 against the convention's size and accessibility rules.
