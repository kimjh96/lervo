# Lervo ADE convention

Status: `proposed`
As of: 2026-11-22

This profile extends the [code convention](code-convention.md) for the Lervo ADE that [ADR-0613](../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md) proposes: the Rust session host and the React user interface. The code convention stays authoritative. This profile adds the rules the owner set for the ADE: it runs on the Lervo core, keeps a strict structure, performs at its best at all times, is ready for cloud hosting and for more languages, and accepts new providers without rework.

## The Lervo core is the foundation

The ADE is a surface and a process host over the Lervo core. It never becomes a second implementation of it.

- **Core owns every decision.** Workstreams, workspaces, context delivery, policy, verification, evidence, knowledge, and model selection stay in the existing Lervo packages. The ADE adds presentation (the UI), process hosting (the session host), and application commands that compose existing core packages.
- **No parallel logic.** An ADE feature that needs a decision the core lacks adds it to the owning core package, with that package's tests and documentation. It never adds the decision to the UI or the session host.
- **One host endpoint.** The UI talks to one endpoint per host, the session host. The session host forwards application commands to the host's resident Lervo application process, which runs the core in Node. This avoids starting a Node process per action. A one-shot `lervo` CLI call is the fallback when the resident process is unavailable.
- **Core failures stay visible.** When a core command fails or reports attention, the ADE shows the core's code and parameters. It never hides the failure or substitutes its own state.
- **Core contract tests cover ADE paths.** Each application command the ADE uses has core tests for its success and failure meanings before the ADE depends on it.

## Structure

### Layers

Each side has four layers. Dependencies point inward only.

| Layer       | Session host (Rust)                                                                    | UI (React)                                            | May depend on          |
| ----------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| Contract    | `session-protocol`: generated message types and the protocol version                   | the protocol package: the same generated types        | nothing                |
| Domain      | `session-core`: session lifecycle, conversation index, scrollback, pure state machines | `features/*/model`: view models and state transitions | Contract               |
| Adapters    | one crate per external boundary: PTY, stream process, local transport, segment store   | `platform/*`: session-host client, OS integration     | Contract, domain ports |
| Composition | the `session-host` binary wires adapters to the domain                                 | `app/`: routing, context providers, feature mounting  | all layers above       |

- Domain code performs no I/O. It does not import process, filesystem, network, PTY, Tauri, or DOM APIs. Effects enter through ports (Rust traits and TypeScript interfaces) that adapters implement.
- Composition code only wires. It holds no decisions.
- Each adapter owns one external system.

### Features in the UI

- Each feature, such as `start`, `workspaces`, or `conversation`, lives in `features/<name>/` with `model/` (state, selectors, transitions), `view/` (components), and `index.ts` (its public surface).
- Components render props and dispatch intents. They do not fetch data, parse protocol messages, or hold business rules.
- A feature imports another feature only through its `index.ts`. Import-boundary lint rules enforce this.
- Shared primitives live in `ui/`. They are built on headless primitives and design tokens and know nothing about Lervo concepts.

### Size and cohesion

- The 400-line exact-content review in `scripts/code-convention-reviews.json` applies to `.rs`, `.ts`, and `.tsx` files.
- A component file exports one component. A component over 150 lines, or one that mixes layout with state logic, is a split signal.
- A Rust module that owns more than one state machine, or that mixes parsing with decisions, is a split signal.

### Encapsulation

- Rust items are private by default, and `pub(crate)` comes before `pub`. A crate exports only what its consumers use.
- TypeScript features and packages export through one `index.ts`. Deep imports fail lint.
- Mutable state has one owner. Each session's state belongs to its session actor in the session host, and each feature's UI state belongs to one store. Other code reads through messages or selectors.

### Extensibility and flexibility

- Variation goes behind named strategies or registries. Code never accumulates flags or `switch` statements over providers, conversation modes, or event kinds.
- Conversation rendering uses a registry from event kind to renderer. A new kind adds a schema entry and a renderer; the list code does not change.
- Settings are typed and schema-validated. Each feature switch is a named value with one owner.

### Enforcement

- **Rust.** `rustfmt`, `clippy` with `-D warnings`, `#![forbid(unsafe_code)]` unless a reviewed module needs unsafe code, and `cargo deny` for licenses and advisories. Code outside tests never calls `unwrap` or `expect`.
- **TypeScript.** Strict mode, the repository ESLint configuration, import-boundary rules, and a rule against string literals in JSX (see Localization).
- **Repository gates.** `pnpm quality:check` lints and formats the ADE's TypeScript with the rest of the repository, and its 400-line review covers `.rs` files. `pnpm ade:check` builds the interface and runs `rustfmt`, `clippy`, the Rust tests, and `cargo deny`. Run it for every change under `apps/ade/`; the ADE workflow runs it in CI when ADE paths change. `apps/ade/rust-toolchain.toml` pins one Rust toolchain for the Mac, WSL, and CI.
- **Boundaries.** The package boundary checker and an ESLint import rule keep `@lervo/ade` free of Lervo workspace packages except `@lervo/session-host-contract`. The interface reaches Lervo only through the session-host protocol.
- **Commits.** Changes under `apps/ade/`, Rust included, use the `ade` commit scope.

## Technology stack

[Technology stack](ade-convention/stack.md) records the libraries the ADE uses and why. A new library follows the size and dependency rules of the performance part.

## Performance and resource use

Every resource the ADE uses must be at its best: CPU, memory, GPU, disk, energy, processes, and size. [Performance and resource use](ade-convention/performance.md) defines the rules for each resource, the handling of conversations that grow without bound, the measurement harness, and every budget. Budgets are release criteria.

## Cloud readiness

Cloud hosting is not built now. The foundation must let a remote session host arrive without changing the UI or the shape of the protocol.

- **Transport-independent protocol.** The UI talks to a session host through a versioned message protocol over an abstract transport. The local socket is the first transport. An authenticated remote transport is a later adapter.
- **Location-free identities.** Workspaces, sessions, and hosts have opaque IDs. Paths are repository-relative and appear only inside the host that owns them.
- **No filesystem access from the UI.** The UI reads files, diffs, and Lervo state through the session host, never by path.
- **Authentication from the start.** The local channel already performs a handshake that names the caller and its authority. A remote transport replaces the credential source, not the handshake.
- **Resumable sessions.** A reconnecting client resumes from its last applied sequence, so latency and dropped connections need no new mechanism.
- **Hosts as peers.** A cloud session host is one more host. Lervo's local-authority and Hub rules apply to it unchanged. Invariant 1 still holds: local work needs no Hub and no cloud.

## Localization

The ADE ships in English only. Every surface is still built for more languages.

- **Message catalogs.** All interface text comes from ICU MessageFormat catalogs keyed by feature. `en` is the only catalog. Lint rejects string literals in JSX and in user-facing Rust messages.
- **Codes across boundaries.** The session host and the Lervo core send stable codes with parameters, such as `workspace_start_failed` with `stage`. Only the UI turns them into text.
- **Platform formatting.** Dates, numbers, relative times, and plurals use the `Intl` APIs. Code never concatenates translated fragments.
- **Layout.** Styles use logical properties, such as `margin-inline-start`, so a right-to-left language needs no restyling. Labels tolerate longer text.
- **Locale choice.** The UI picks a locale from the OS, falls back to `en`, and stores the choice in settings.
- **Conversation text.** Messages from the user and the agent are never translated. They keep their own language.

## Providers

The ADE supports Claude Code and the Codex CLI first. Gemini, Grok, and later providers must be addable without changes to the UI, the session host, or other adapters.

- **One adapter per provider.** Each provider is one package behind `@lervo/adapter-contract`. The adapter owns everything specific to its provider: CLI detection and version, login inspection, the hosted launch descriptor, hook installation, decoding of the structured stream into common conversation events, and normalization of hooks into hosted observations.
- **Capabilities, not names.** Each adapter declares capabilities, such as `nativeConversation`, `sessionIdBinding`, `hooks`, `mcp`, and `systemPromptFile`. The UI and the session host read capabilities and never branch on a provider ID. A provider without `nativeConversation` offers only the CLI conversation. A provider without `hooks` records the unmanaged ladder.
- **A registry, not an enum.** Providers come from a registry of admitted adapters (ADR-0536). Code that accepts a fixed `codex|claude` value moves to the registry before a third provider lands.
- **Common contract tests.** Each adapter passes the shared adapter contract suite, including the hosted-session cases, before admission.
- **Model choice through roles.** Adapters take the provider, model, and effort from Lervo's model selection by role (ADR-0612), never from their own settings.

## Quality beyond the named requirements

[Quality requirements](ade-convention/quality.md) covers reliability, data integrity, security, privacy, accessibility, compatibility, cross-host parity, observability, and testing. These rules carry the same weight as the requirements above.
