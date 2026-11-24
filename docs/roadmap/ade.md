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
| S1.5a Shell and foundations    | The Tauri shell that starts or reaches the session host and relays the protocol over IPC, the native window material on macOS, the token file with generated CSS and terminal themes, the compiled `en` catalog, the session-host client with reconnection, and the application frame in light and dark modes.                                                                                                                                                                                                      | The shell starts the session host and connects to it on the Mac, and the interface checks pass on the Mac and Linux CI.                                                    |
| S1.5b Start and workspaces     | The start screen with the instruction, repository, provider, and mode; `workspace.start` through the core link; the workspace list from a `workspace.list` core command with live status; and notifications.                                                                                                                                                                                                                                                                                                        | An instruction from the start screen opens a workspace whose status follows its session.                                                                                   |
| S1.5c Native conversation      | The conversation with virtualization, frame-bound streaming, paging by `conversation.range`, the motion patterns, and the stylesheet check for motion tokens.                                                                                                                                                                                                                                                                                                                                                       | The S1 conversation verification items of ADR-0613 pass.                                                                                                                   |
| S1.5d CLI conversation         | The CLI conversation in xterm.js with the terminal theme, input, resizing, switching a workspace between modes, and restarting the session host when it cannot be reached.                                                                                                                                                                                                                                                                                                                                          | The S1 verification items of ADR-0613 pass, apart from the launch events of S1.4c.                                                                                         |
| S1.5e Approved mockups         | The interface as the approved mockups show it: the window glass on the native material at the mockups' tint, the sidebar with "New work", the start card, the workspace header, the conversation and the terminal on the glass, the missing motion patterns, and Lervo as the only visible name.                                                                                                                                                                                                                    | Screenshots of the real window match the mockups in both modes, and the measured contrast meets the visual language.                                                       |
| S1.6a Session host harness     | Load scenarios for the session host: a 100,000-item conversation index, streaming at the fastest rate, input during a terminal flood, and a soak of repeated sessions, with the fixes the measurements require.                                                                                                                                                                                                                                                                                                     | Each session host budget meets its target or carries a reviewed revision.                                                                                                  |
| S1.6b Interface harness        | The interface scenarios in the shell's webview: cold start, idle CPU, a 100,000-item conversation opened and scrolled, streamed deltas to screen, keystroke echo, and the bundle-size check on every pull request.                                                                                                                                                                                                                                                                                                  | Each interface budget meets its target or carries a reviewed revision.                                                                                                     |
| S1.6c Markdown                 | Agent messages render Markdown with the design system's typography, from a parser chosen by bundle size and parse time, without HTML strings, and within the start screen's budget.                                                                                                                                                                                                                                                                                                                                 | The choice is measured and recorded, the renderer passes its tests in both modes, and the start screen's bundle stays within its budget.                                   |

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

### S1.5a measurements

On the owner's Mac on 2026-11-23, the interface built in 2 s. The bundle is 250 KB of JavaScript (78 KB gzip) and 6 KB of CSS (2 KB gzip). React and React DOM make up most of it; the message parser stays out because the catalog is compiled. S1.6 sets the bundle budget from this baseline.

### S1.5c measurements

On the owner's Mac on 2026-11-23, the interface bundle with the native conversation is 303 KB of JavaScript (94 KB gzip). TanStack Virtual and the conversation feature add 44 KB over S1.5b. The 100,000-item budgets wait for the S1.6 harness.

### S1.5d measurements

On the owner's Mac on 2026-11-23, the initial interface bundle stays at 303 KB of JavaScript, 94 KB of it gzip. The terminal loads on first use as a separate 449 KB chunk with xterm.js and its WebGL renderer.

### S1.6a measurements

`cargo run --release -p lervo-session-store --example index_100k` and `cargo run --release -p lervo-session-host --example load -- streaming|flood|soak` measured on the owner's Mac on 2026-11-23:

| Scenario                                                                | Result                                     | Budget                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Index of 100,000 items of 400 bytes: open, newest page, random page p95 | 0.24 ms, 0.03 ms, 0.05 ms; 40 MB on disk   | First paint 100 ms (the interface adds its share in S1.6b) |
| Streaming at the fastest rate, provider output to client, p95           | 0.75 ms at over 2 million lines per second | 33 ms to the page                                          |
| Keystroke echo during a 1.8 MB/s terminal flood, p95                    | 0.1 ms                                     | 50 ms                                                      |
| Memory after 400 sessions opened and stopped                            | 0.9% below the cold baseline               | Within 5%                                                  |

The measurements found three problems, fixed in S1.6a:

- **Streaming.** Every streamed line became its own message, so the p95 was 26.8 ms at the fastest rate. The native session now merges consecutive deltas of one item into one message of at most 64 KiB, which brought the p95 to 0.75 ms.
- **Soak.** Memory grew 23% after 200 sessions, because each ended session kept its actor and its full 2 MiB scrollback for 10 minutes. An ended session now keeps the last 256 KiB, and opening a session releases the oldest ended sessions beyond 32.
- **Cancellation.** `FrameReader::next` grew its buffer before a read completed, so cancelling it corrupted the stream. It now reads into a separate chunk. A test with short timeouts fails on the old code and passes on the new.

At the `yes` maximum, around 13 MB/s, a client falls behind, and the session host drops its frames and asks it to resynchronize, as designed. An echo that falls in the dropped range is not shown until the client attaches again, so the flood budget is measured at a build-log rate.

### S1.5e: the approved mockups

On 2026-11-23 the owner ran the app and found that it did not look like the approved mockups: the glass did not show, the layout and copy differed, and motion was missing. Screenshots of the real window confirmed it. S1.5e rebuilt the interface from the mockups and checked each screen on the real window against them.

- **Glass.** A red window behind the app showed almost no color through it. The macOS `sidebar` material is nearly opaque in light mode, and S1.5a's tint of `0.88`, set from a blended contrast estimate, covered what remained. The window now uses the `fullScreenUI` material, keeps it when inactive, and carries the mockups' tint of `0.60` in light mode and `0.75` in dark mode. The visual language records the contrast measured on the real window over five backdrops; four text and status colors and five terminal colors changed slightly to pass there.
- **Layout and copy.** The sidebar starts with "New work ⌘N" under the window controls, without a logo or name. The start screen asks "What should Lervo do?" over one card with the repository and agent chips and a send button, and explains what starting does. The start screen no longer asks for a conversation mode: the core now uses the provider's preferred mode, and the workspace header switches it. The header shows the title, the branch, the live status, and the mode switch. Conversation turns, the reply card, and the terminal follow the mockups, and the terminal sits on the glass with a transparent background.
- **Floating reply card.** The owner then asked that the reply card and "Jump to latest" stop holding a band of their own. They now float over the conversation on glass, and the conversation runs beneath them and fades out at the bottom of the window.
- **Motion.** Switching workspaces, switching modes, and opening the start screen fade the new view in over `change`. A workspace that starts while the user watches enters the list with the arrival motion. The working line sits above the reply card. The command palette and the tool activity disclosure wait for their features: the palette does not exist yet, and tool activity carries no details to disclose.
- **Behavior found on the real window.** The conversation opened above its newest item, because programmatic scrolling counted as the user scrolling up. It now follows the live end until a wheel, key, or scroll-bar drag moves up by any amount, and only reaching the bottom returns to it. It keeps the item being read in place when pages load above it, and loads later pages after the window was trimmed. The owner then found that a small scroll up snapped back to the bottom and that a long reply jumped to the top; a reproduction in headless WebKit with the real component confirmed both before the fix and passes after it. Switching a workspace's mode now shows the mode the session host confirms at once, instead of waiting for the reloaded list. React's development double start opened two shell connections that ended each other in a loop; the client now connects once and ignores a replaced connection's end. Sends and keystrokes now reach the shell in order: the shell handles each call as its own task, so order was not guaranteed. Typing at 2 ms intervals did not reorder without the change, so this is a guarantee, not a reproduced fault.
- **Name.** The executable is named `Lervo`, so the menu bar and the Dock show Lervo even outside an application bundle.

`cargo run --release -p lervo-session-host --example interface -- serve <dir>` serves a scripted core with four workspaces, one with a seeded conversation of 100,000 items, and the shell reaches it with `LERVO_SESSION_HOST_DIR=<dir>`. S1.5e used it for every screenshot, and S1.6b uses it for the webview scenarios.

### Convention check after S1.5e

On 2026-11-23 the owner asked for a convention check before S1.6b. An independent review of `apps/ade` against the ADE convention and the code convention found four groups of problems. With the design system the owner asked for the same day, they land as five groups, in this order:

1. **Correctness and failure visibility.** A reply had no answer, so the interface waited 30 seconds and took the timeout for success; `session.resync_required` had no handler; several failures were dropped or collapsed into one message; the window waited for the login shell before opening; and terminal output had no per-frame limit. The first pull request adds `session.sent`, resynchronizes both conversations, shows each failure's code, resolves the login `PATH` in the background, and writes terminal output once per frame.
2. **Interface structure.** Models reach adapters directly instead of through ports, the frame holds view decisions, the pending workspace copies the conversation's layout and first message, collections lack byte limits, nothing reacts to a hidden window, styles use physical properties and literal sizes, and the composer's draft is lost when the view changes.
3. **Session host internals.** Index and process work runs under the registry lock and on async workers, `host.rs` mixes dispatch with the session lifecycle, a mode switch polls and can open a second provider process, terminal output is copied more than once, and the shell bypasses the transport adapter.
4. **Design system.** The owner asked on 2026-11-23 for a design system that keeps the interface consistent and its components reusable and extensible, because documentation and an introduction site are planned. It covers everything such a system holds, from the design language and every foundation to components, patterns, content, accessibility, and governance; the [design system plan](ade/design-system.md) lists its scope, order, and completion. It comes after the session-host internals, which are correctness work, and before the registries, whose provider choice and mode switch build on its components. It lands in several pull requests. The first wrote the design language and the foundations in the [ADE design system specification](../specifications/execution/product-surfaces/ade-design-system.md) and recorded the audit of the interface in the plan.
5. **Providers and modes from registries.** The start screen lists providers by name and the header offers both modes regardless of capability; the core adds a provider list with capabilities, and the interface and the session host read registries. The [providers and modes plan](ade/providers-and-modes.md) holds the design, including how the app keeps working with an older core.

The owner also removed the 150-line component signal and stated that the design principles apply to every change, beyond any checklist; the ADE convention records both.

The second pull request resolves the interface structure and one motion problem the owner found:

- **Ports and composition.** Models and views reach the session host, application commands, notifications, and drafts through `ports/`. `main.tsx` builds the adapters, `app/` only binds and mounts, and the main area's view comes from a selector in the start feature.
- **One conversation pane.** The pending workspace renders through the conversation feature with a stand-in strategy, so its first message and layout have one owner. Both headers share one primitive.
- **Bounds and drafts.**
  - Live arrivals and workspace arrivals stay within the window and the list.
  - Recently closed conversations are an LRU cache by bytes.
  - The reply card and the start screen keep their drafts across reloads, with coalesced writes in local storage.
- **Presentation.**
  - A hidden window pauses every animation, and the shared keyframes are defined once.
  - Stylesheets use logical properties and tokens.
  - Every message has a static ID that a test checks against the catalog, and inputs show their focus.
  - Import-boundary lint rules enforce the layers.
- **What stays, stays still.** A conversation mode switch faded the whole view, title included, because the view's key held the mode. The key now names only the workspace, a header decides its arrival when it mounts, and selecting the selected workspace changes nothing. The ADE motion principles record the rule.
- **Launch view.** On 2026-11-23 the owner noticed that Lervo opened on an empty window. The window now opens hidden and shows once its page can paint, with the Lervo mark, which stays until the first lists load, within the cold-start budget. In headless WebKit the mark paints 22 ms after navigation once the stylesheets are cached, so the empty window the owner saw first came from the webview starting, not from the page. The shell sets the window material before the first paint, and the window's tint moved from the frame to the document. The first screen therefore replaces the mark without the window changing color, and in WebKit the start screen still matches its earlier rendering byte for byte.

Three findings move to later groups. The provider names on the start screen and the result schemas of application commands go with the provider registry (group 5). The terminal input encoding and the duplicated mode translation in Rust go with the session-host internals (group 3).

The third pull request resolves the session-host internals:

- **Nothing blocks a worker or holds a lock across I/O.** Starts open their index and spawn their process off the async workers, outside the registry's lock, serialized by a lifecycle lock. Each conversation index reads and writes on its own thread, and each PTY writes input on its own thread, fed through a queue the actor drains without waiting.
- **One owner each.** `host.rs` became the host's state, `dispatch.rs` the client messages, and `lifecycle.rs` starts and mode switches. The session watch is one task. A mode switch waits for the end signal of the running process instead of polling, and fails with `session_stop_timeout` instead of opening a second process.
- **Failures keep their meaning.**
  - A missing CLI reports `provider_cli_unavailable`, and a PTY or process the system refused reports `session_start_failed` with its reason.
  - A core that did not answer reports `application_timeout`, and timed-out requests leave the core link's table.
  - A PTY that refuses input or a resize ends its session as failed.
  - A failed accept backs off instead of spinning.
  - The domain no longer parses the core's codes.
- **Bounded and shared.**
  - Replies and watched statuses count their exact encoded size against a 16 MiB connection budget.
  - Terminal chunks are shared from the PTY reader through the scrollback to every replay.
  - A broadcast encodes once.
- **Adapters.** The shell connects through the transport crate and sends terminal input as a raw body, and the mode translation lives in one place.

### Session host diagnostics

The convention check found that the session host kept no log: its standard error went nowhere, so a connection that ended with an error, or an accept that failed, left no trace. On 2026-11-23 the session host gained a diagnostics log in its state directory, as the session-host protocol's "Privacy and failure" section defines:

- **What it records:** event names, counts, identifiers, and codes, and never bodies or terminal bytes.
- **Its bounds:** 512 KiB with one rotated file.
- **Its tests:**
  - a unit test fills the log past its bound and finds the oldest entries gone;
  - a test against a served host finds a broken handshake and a failed request recorded by code only.

### The terminal leaves the ADE

On 2026-11-23 the owner used the CLI conversation on the Mac:

- Hangul typed through the input method lost its first syllable.
- Hangul left gaps in its cells.
- The transparent background turned inverse and dim text black, and then dim text nearly invisible.

The owner asked why the ADE needs a terminal, and decided to remove it for now and to support only Claude Code until other providers offer the native conversation ([ADR-0617](../decisions/execution/applications/0617-offer-only-claudes-native-conversation-in-the-ade-for-now.md)).

- **What left.** The interface's terminal, the mode switch, xterm.js, the terminal palette, and the shell's terminal relay are gone.
- **What stays.** The core keeps its CLI launches. The session host keeps its CLI mode, which its tests and load examples exercise, so the terminal can return by restoring the interface.

The terminal quality follow-up below is superseded until the terminal returns, and ADR-0617 lists what it must fix then.

### Transcript sync and the CLI conversation's quality

On 2026-11-23 the owner tried the app built from `main` and found two problems.

- **Messages did not carry over between the modes.** Messages sent in the CLI conversation did not appear in the native conversation. The native index held only what its own stream decoded, though the sessions specification makes the provider's transcript the canonical conversation.
  - The fix reads the transcript through the new `transcript.read` request whenever a native session opens. It rebuilds the index when the transcript holds a different number of items. The same path heals a damaged index.
  - The test also showed the app's provider inheriting an enclosing Claude Code session's markers: it stopped saving its transcript and could reach that session's messaging channel. Launches now name the variables the session host must not pass on, and the Claude adapter lists the markers.
  - The fix shipped in v0.42.0. On 2026-11-23 the owner ran the app against it on the Mac and confirmed that turns from the CLI conversation appear in the native conversation.
- **The CLI conversation was hard to use in Korean.** The owner asked to improve it later, as one bounded follow-up:
  - Hangul renders with gaps, because JetBrains Mono has no Hangul glyphs and the fallback is narrower than two cells;
  - Hangul input through the IME is unreliable in xterm.js on WKWebView;
  - in light mode, the provider's own colors, a black status bar and a dark prompt bar, assume a dark terminal.

  The follow-up enables xterm.js's Unicode 11 widths with a CJK-capable monospace fallback, makes IME composition reliable, tells the provider the terminal is light, and tunes the palette. Real-window screenshots in both modes, and typing Korean in the terminal, verify it.

### S1.6b progress

`apps/ade/scripts/check-bundle-size.mjs` runs in `pnpm ade:check` on every pull request. On 2026-11-23, after the terminal left and the start screen read the provider registry, the start screen loads 99.5 KB of gzip JavaScript against a 120 KB budget. The largest lazy chunk, the Markdown renderer, is 16 KB against 160 KB.

**The harness.** `apps/ade/scripts/measure-webview.mjs` runs the webview scenarios against the release shell and the scripted core of `session-host/examples/interface`, one window per scenario. Its header lists the builds it needs.

- **The shell's part.** Only with `LERVO_ADE_MEASURE=<scenario>` and `LERVO_ADE_MEASURE_OUT=<path>` does the shell tell the page its scenario and accept its report.
- **The page's part.** It loads the measurement module, `src/platform/measure/`, lazily. The module drives the app through the DOM, as a person would.
- **CPU and memory.** The driver samples them for the shell and the WebKit processes that started with it.
- **Keystrokes.** They come from the page, so the keystroke figure is the interface's share of the echo, without the system's input path.

**First measurements.** On 2026-11-23, on the owner's Apple Silicon Mac, with the app built from `981b6179b`:

| Measure                                                                             | Measured                         | Budget                     |
| ----------------------------------------------------------------------------------- | -------------------------------- | -------------------------- |
| Cold start to the start screen (warm; the first launch after a build took 2,897 ms) | 576–679 ms                       | 500 ms                     |
| UI CPU, idle, window visible                                                        | 1.6% of one core                 | 0.5%                       |
| UI CPU, idle, window hidden                                                         | 0.2%                             | 0.1%                       |
| First paint of the 100,000-item conversation                                        | 165 ms                           | 100 ms                     |
| Scrolling it: p95 and longest frame                                                 | 18 ms and 35 ms, none over 50 ms | 60 fps, no task over 50 ms |
| Streamed delta to screen, p95                                                       | 385 ms                           | 33 ms                      |
| Keystroke to echo, p95                                                              | 36 ms                            | 16 ms                      |

That run timed each page figure at the second frame after the change, so first paint, streaming, and keystroke read about one frame (17 ms) high. The harness now times them at the next frame.

**What the figures show.**

- **Cold start.** The page reaches the start screen 250–330 ms after navigation. The shell takes 240–420 ms before navigation starts. Both parts need work.
- **Idle CPU.** Something keeps drawing or polling while nothing should move (motion principle 4).
- **Streamed delta to screen.**
  - The pacer resets its 120 ms deadline whenever the text grows. Under the fastest steady stream, text that arrived first trails by up to 136 ms, one frame more than `motion.duration.pace` allows. That accounts for little of the measured figure, so most of the delay lies between the provider and the store, and the next run needs per-layer timestamps.
  - The budget of 33 ms also conflicts with the 120 ms pace the motion principles allow. One of the two needs a reviewed revision.
- **First paint and keystroke echo.** Both stay over budget after the one-frame correction, by about 50 ms and one frame.

**Second measurements.** On 2026-11-24, with the app built from `d8450bfd5`, after the pacer's fix (#365) and the per-layer split (#366):

| Measure                                                        | Measured                                          | Target before revision     |
| -------------------------------------------------------------- | ------------------------------------------------- | -------------------------- |
| Cold start to the start screen (warm; the first launch: 2,816) | 502–605 ms                                        | 500 ms                     |
| UI CPU, idle, window visible                                   | 1.83% (shell 0.70, GPU 0.50, WebKit content 0.63) | 0.5%                       |
| UI CPU, idle, window hidden                                    | 0.13%                                             | 0.1%                       |
| First paint of the 100,000-item conversation                   | 324 ms                                            | 100 ms                     |
| Scrolling it: p95 and longest frame                            | 19 ms and 43 ms, none over 50 ms                  | 60 fps, no task over 50 ms |
| Streamed delta to the page, p95                                | 19 ms                                             | (not measured before)      |
| Streamed delta to screen, p50 and p95                          | 100 ms and 143 ms                                 | 33 ms                      |
| Keystroke to echo, p50 and p95                                 | 17 ms and 19 ms                                   | 16 ms                      |

**What the second run shows.** The owner's Mac was busy with other work during this run and the idle runs below, so CPU and latency figures may read high.

- **Streaming.** Deltas reach the page within 19 ms at p95. At p95 the screen trails the page by about the 120 ms pace, but percentiles do not show each delta's trail; the harness now measures it.
- **Keystroke echo.** At p95 the interface shows a keystroke in the next frame. The slowest took 58 ms.
- **Idle CPU with the window visible.** In the first 10 seconds after the start screen, the page saw at most five DOM changes, two host replies, and no running animation. The figure comes from the focused input card. Each of these is one 30-second sample:
  - with the focus dropped, 0.03%;
  - one focused text field alone in the same window, 1.57%;
  - a transparent caret, or the input card without its `backdrop-filter`, changed nothing.
- **The hidden window.** 0.13% is four hundredths of a CPU second in 30 seconds, close to what `ps` can resolve. The harness now samples a hidden window for 120 seconds.
- **First paint** varies between runs (165 ms and 324 ms) and misses by more than its target.

**Revisions.** Three targets measured something besides the interface's own work: idle CPU with the window visible, streamed delta to screen, and keystroke echo. The [performance rules](../foundation/ade-convention/performance.md#revisions-after-the-first-baseline) revise them and say why. Against the revised targets, this run meets the streaming targets (19 ms and 143 ms against 33 ms and 153 ms) and the keystroke target (19 ms against 25 ms); idle with no field focused measured 0.03% against 0.5%.

**Harness changes after an independent review.**

- The page settles for five seconds before it observes an idle window, and the driver samples CPU right after.
- An idle figure counts only from a window in front with the expected element focused.
- The driver skips the CPU sample when the page reports an error.
- New figures: each delta's trail behind its arrival, each keystroke's work, and the lone field in an opaque window.

**Cold start.** Before the first screen, the page waited on two steps it did not need:

- the Tauri API and the notification plugin loaded as separate chunks after the main script;
- the page waited for the system's notification permission before it started React or the session host connection.

The page now bundles both modules with the main script and checks the permission at the first notification. The start screen then waited for the session host connection, its handshake, and the core's first `workspace.list`, although the performance rules say it renders from cached workspace state. It now shows the lists the core answered last, kept in the webview's local storage, and the core's answer replaces them. The kept copy holds workspace titles, branches, and repository names, at most 512 Ki code units. While the first connection takes under a second, the frame no longer says it is connecting. The harness now splits the cold start into three parts: launch to the shell's `main`, `main` to navigation, and the page's own steps. The page's steps are its script loads and the marks `main`, `host-connected`, and `launched`. No run has measured the effect yet.

**Remaining work.** S1.6b completes when each budget meets its target or carries a reviewed revision. The order is:

1. a full run of the harness on an otherwise idle Mac, with the new figures, the cold-start split, the first-paint change on branch `ade-first-paint`, and the hidden window sampled for 120 seconds;
2. the first paint and cold start, by what that run shows.

### S1.6c measurements

On 2026-11-23 three parsers were measured: each one's parse entry bundled and minified for the browser, then timed in Node 26 on an Apple Silicon Mac. The inputs were a 1.3 KB reply with a heading, lists, a code block, a table, a quote, and a link; that reply repeated to 76 KB and to 163 KB; and 200 re-parses of the growing reply, as streaming does.

| Parser                                | Bundle, gzip | 1.3 KB  | 76 KB  | 163 KB | 200 streaming re-parses |
| ------------------------------------- | ------------ | ------- | ------ | ------ | ----------------------- |
| `marked` 18.2.1, lexer only           | 15.4 KB      | 0.04 ms | 3.7 ms | 4.5 ms | 3.3 ms                  |
| `markdown-it` 15.0.3                  | 41.0 KB      | 0.06 ms | 3.0 ms | 9.1 ms | 6.4 ms                  |
| `mdast-util-from-markdown` 2.0.3, GFM | 23.6 KB      | 0.55 ms | 48 ms  | 157 ms | 63 ms                   |

`marked` won on size and speed. The core's `mdast-util-from-markdown` was too slow for the streaming path. The ADE renders `marked`'s tokens as React elements, so no HTML string reaches the page. The renderer is a lazy chunk of 16.1 KB gzip, loaded right after start; the start screen still loads 99.8 KB of its 120 KB budget.

### ADE versions

On 2026-11-23 the owner asked for ADE versions and release notes like the CLI's. [ADR-0615](../decisions/release/packaging/0615-version-the-ade-apart-from-the-cli.md) gives the ADE its own version line, with `ade-v` tags and intents in `.changes/ade/`, prepared apart from the CLI. The work is complete when:

- the release tooling accepts ADE intents and every test under `scripts/release` passes, intents without a target included;
- CLI preparation ignores ADE intents;
- one ADE preparation has written `0.2.0` to every ADE manifest with its release notes and tagged `ade-v0.2.0`.
- each ADE tag has a GitHub Release `@lervo/ade v<version>` with its notes, never marked "Latest" ([ADR-0630](../decisions/release/packaging/0630-publish-ade-release-notes-before-s3.md)), 0.2.0 and 0.2.1 included.

On 2026-11-24 the owner asked why the ADE had no release notes: ADR-0615 had deferred GitHub Releases to S3, so the notes lived only in Git history. ADR-0630 publishes them now, after the host follower's release list widens past ADE releases. The widening shipped in v0.46.8 (#376) and passed its canary on both hosts. `@lervo/ade v0.2.0` and `v0.2.1` were then published from the notes at their tags. After that, `releases/latest` stayed `v0.46.8`, and a follower plan on both hosts selected no ADE release.

### The session host in the application bundle

On 2026-11-24 the owner's Lervo app still ran from a development worktree: its bundle was built there, and the session host it started was that worktree's build. `pnpm --filter @lervo/ade bundle` now builds the session host and passes Tauri a configuration that adds it as an external binary. The bundle therefore carries `lervo-session-host` beside the shell, where the shell looks for it. Only that build stages the binary, so `cargo build`, Clippy, and the tests never need it. The owner's app now runs from `/Applications/Lervo.app` with its own session host.

A newer app still met the session host that an older one started, because the session host outlives the window and the shell connects to whatever answers. Now the shell reports the session host's version from `welcome`, with its own, after each handshake. When the session host is older, the sidebar offers to restart it and says what stops ([protocol](../specifications/execution/product-surfaces/ade-session-host-protocol.md), "Replacing an older session host"). The shell finds the session host's process from the socket's peer, which works with every session host already installed, and ends it with SIGTERM. The interface never restarts on its own: `sessions.watch` gives no sign that every running session's status has arrived, so it cannot know that no agent is working. On the owner's Mac, tests showed that the socket reports the session host's process and that SIGTERM ends a process. The first real handover is the owner's 0.3.0 session host meeting the next ADE release.

### The owner's review of the installed app

On 2026-11-24 the owner used the installed app and asked for four changes:

- **Removing a workspace that was just started showed "Creating the workspace".** Removing deselects the workspace, and the pending start that created it stayed, so the main area showed the pending workspace again. Leaving the workspace a start created now settles that start.
- **The branch beside the title.** The header no longer prints the branch. A quiet branch icon names it on hover or focus and copies it when pressed, through a new clipboard port.
- **Waiting.** "Removing…" looked like a test. Every wait now follows one system ([patterns](../specifications/execution/product-surfaces/ade-design-patterns.md), "Waiting"): it names the activity where it happens and shows only after `motion.duration.wait`. It carries the working line's highlight, and no control is left disabled beside it. `Waiting` joins `WorkingLine` in the design system. Removing a workspace names its steps, and the connection status, the session host restart, and an opening conversation use it. The message catalog test rejects an ellipsis, "Loading", and "Please wait".
- **A new conversation appeared without a fade.** The owner has not yet said which change it was, so it stays open.
- **The start screen's explanation.** The line under the card said what sending does on every visit, and the pending workspace already shows it. The start screen now adds a note only when no repository is registered or an older Lervo limits the choice.
- **Things vanished in a frame, and features kept skipping the motion rules.** After the owner pressed Restart, the restart offer simply disappeared: the new session host ran, but nothing said so, and the line left without motion. The owner then asked why each new feature ignored the motion principles. Nothing enforced them for elements that come and go, and 16 such elements had no decided motion. `Presence` now brings their arrival and leaving. A lint rule rejects any element that comes and goes without `Presence` or a named catalog row, and a test checks the names. A result the screen does not show, such as the restart, is stated in place for `motion.duration.settle`.
- **A white flash in dark mode.** Changing between the start screen and a workspace used view transitions, which fade two snapshots of the window over each other. In the translucent window the page's light base color showed through while both were half transparent. The arriving view now fades in over the live window instead, and the leaving view leaves at once.

### S1.4c progress

S1.4c lands in three pull requests, because its events need event schema 10, and every reader must read a version before a writer selects it.

1. **Readers and the target (#354, v0.44.0).** The CLI, the Node, and the Hub read schema 10, and `lervo upgrade` targets it.
   - On 2026-11-23 the WSL Hub was deployed by hand from v0.44.0 and reported schema versions 1 to 10.
   - A registered repository on the WSL host then activated schema 10.
2. **Hooks and writers (#357, v0.45.0).**
   - The Claude adapter declares `hooks` and passes a session-scoped settings file with Lervo's `SessionStart` and `SessionEnd` handlers.
   - `lervo workspace start` and `lervo workspace open` record `application.workspace.started` and `terminal.session.launch_prepared` in the registered repository's store.
   - `lervo workspace hook` records `launched` and `ended`.
   - Writers check the selected writer version, never the CLI version, and record nothing below schema 10.
3. **The session host's exit report (#361, ADE 0.2.0; #362, v0.46.0).** When a provider process exits without `SessionEnd`, for example after a crash or SIGKILL, the session host reports the exit through the core link. The core then records `terminal.session.ended` with `process_exited` and the exit code.
   - **3a, the core.** It answers `session.exited`, advertises it in `workspace.list`, and records the end unless the hook already did.
   - **3b, the session host.** It ends a provider process with SIGTERM before SIGKILL, so the provider runs its `SessionEnd` hook. It then reports the exit to a core that advertises `session.exited`. This is the first change under the ADE's own version line.

S1.4c completed on 2026-11-24. After v0.45.0, a canary on the WSL host recorded `launched` and `ended` at schema 10 from the hooks. After v0.46.0, the resident process listed `session.exited` in `workspace.list` and answered an unknown session with `unknown_session`. The adapter's tests check that the session-scoped settings file holds only Lervo's hooks, so the user's own settings files keep their bytes.

`terminal.tool.observed` and `terminal.instructions.loaded` wait for S2, which defines their fields with the hosted evidence.

### Order after S1.4b

S1.4c follows S1.5. Its events need a new event schema version, and a writer may select a version only after the Hub and Node readers support it, which takes a release and a deployment first. The interface does not depend on those events.

### S1.4 split

The core had no resident application endpoint, no hosted launch path, and no worktree creation on a new branch, so S1.4 was split into three increments on 2026-11-23. S1.4a prepares launches through one-shot commands. S1.4b adds the resident process, which ADR-0613 requires so that no action pays for a Node start, and moves stream decoding there. S1.4c records the launch events once a new event schema version can carry them.

## S2 and S3

ADR-0613 defines S2 (hosted evidence and Lervo tools) and S3 (distribution). Their increments are defined when S1 completes, from what S1 measured.

## Open items

- Before public distribution, the publisher accepts Anthropic's Commercial Terms of Service and checks OpenAI's terms for the Codex CLI.
- Component primitives are chosen in S1.5 against the convention's size and accessibility rules.
