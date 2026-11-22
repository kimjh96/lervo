# Lervo ADE technology stack

Status: `active`
As of: 2026-11-23

This part of the [Lervo ADE convention](../ade-convention.md) records the technology the owner approved for the ADE on 2026-11-23. A change to a row here needs the same review as a convention change.

## Desktop interface

| Area                  | Choice                                                               | Reason                                                                        |
| --------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Shell                 | Tauri 2 (Rust)                                                       | Small binaries and memory; native window material, notifications, and updates |
| Webview               | The platform's own: WKWebView, WebView2, and WebKitGTK               | No bundled browser engine                                                     |
| Interface             | React 19, TypeScript in strict mode, Vite                            | The owner's choice; Vite builds the interface in under a second               |
| State                 | Zustand, one store per feature                                       | Fine-grained selectors re-render only what changed                            |
| Styling               | CSS Modules over CSS custom properties generated from the token file | No runtime cost; one token file produces both themes                          |
| Accessible primitives | Radix UI primitives, wrapped in `ui/`                                | Keyboard and screen-reader behavior without reimplementing it                 |
| Long lists            | TanStack Virtual                                                     | Variable-height virtualization for unbounded conversations                    |
| Localization          | FormatJS with catalogs compiled at build time                        | ICU messages without a runtime parser                                         |
| CLI conversation      | xterm.js with its WebGL renderer                                     | A proven terminal renderer                                                    |
| Markdown and code     | Chosen in S1.5 by measurement against the performance budgets        | The heaviest rendering path, so the choice needs evidence                     |

## Session host

| Area               | Choice                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Language           | Rust 2024 edition with the toolchain pinned in `apps/ade/rust-toolchain.toml`                                             |
| Async runtime      | Tokio                                                                                                                     |
| PTY                | portable-pty                                                                                                              |
| Local transport    | Unix domain sockets, Windows named pipes through `interprocess`, and token-authenticated loopback between Windows and WSL |
| Framing            | Length-prefixed binary frames carrying MessagePack                                                                        |
| Conversation index | Append-only segment files with offset tables, without a database                                                          |
| Host files         | `dirs` for the platform state directory, `fd-lock` for the single-instance lock, and `getrandom` for the connection token |
| Logs and errors    | `tracing` with a size limit and rotation, and `thiserror`                                                                 |

## Lervo core

- `lervo workspace start` and the resident application endpoint live in the existing CLI and core packages.
- Claude Code and Codex launch preparation and stream decoding extend `@lervo/adapter-claude` and `@lervo/adapter-codex`.
- The session-host protocol is one JSON Schema in `@lervo/session-host-contract`, a contract package with no runtime dependencies. TypeScript types come from it through `json-schema-to-ts`, and Rust types through `typify` at build time. Both sides validate every message against the same document, AJV in TypeScript and `jsonschema` in Rust.
- The protocol stays out of `@lervo/schemas`: importing that package's index from the interface added 5.2 MB to the bundle in a measurement on 2026-11-23, because its compiled validators cannot be tree-shaken.

## Quality tooling

- ESLint with React Hooks, `jsx-a11y`, and Lervo's own rule against literal interface text; Prettier; `rustfmt`; `clippy`; `cargo-deny`.
- Vitest with Testing Library for the interface, `cargo test` for the session host, and protocol contract tests on both sides.
- One Linux CI workflow for the ADE. Desktop bundles for macOS and Windows build at release.
