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
| Streaming at the fastest rate, provider output to client, p95           | 0.75 ms at over 2 million lines per second | 33 ms to screen                                            |
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

**Remaining work.** S1.6b completes when each budget meets its target or carries a reviewed revision. The order is:

1. the pacer's deadline, and per-layer timestamps for the stream;
2. idle CPU;
3. the conversation's first paint;
4. cold start;
5. a second run of the harness;
6. reviewed revisions for whatever still misses, such as reconciling the streaming budget with the pace.

### S1.6c measurements

On 2026-11-23 three parsers were measured: each one's parse entry bundled and minified for the browser, then timed in Node 26 on an Apple Silicon Mac. The inputs were a 1.3 KB reply with a heading, lists, a code block, a table, a quote, and a link; that reply repeated to 76 KB and to 163 KB; and 200 re-parses of the growing reply, as streaming does.

| Parser                                | Bundle, gzip | 1.3 KB  | 76 KB  | 163 KB | 200 streaming re-parses |
| ------------------------------------- | ------------ | ------- | ------ | ------ | ----------------------- |
| `marked` 18.2.1, lexer only           | 15.4 KB      | 0.04 ms | 3.7 ms | 4.5 ms | 3.3 ms                  |
| `markdown-it` 15.0.3                  | 41.0 KB      | 0.06 ms | 3.0 ms | 9.1 ms | 6.4 ms                  |
| `mdast-util-from-markdown` 2.0.3, GFM | 23.6 KB      | 0.55 ms | 48 ms  | 157 ms | 63 ms                   |

`marked` won on size and speed. The core's `mdast-util-from-markdown` was too slow for the streaming path. The ADE renders `marked`'s tokens as React elements, so no HTML string reaches the page. The renderer is a lazy chunk of 16.1 KB gzip, loaded right after start; the start screen still loads 99.8 KB of its 120 KB budget.

### ADE versions

On 2026-11-23 the owner asked for ADE versions and release notes like the CLI's. [ADR-0615](../decisions/release/packaging/0615-version-the-ade-apart-from-the-cli.md) gives the ADE its own version line, with `ade-v` tags and intents in `.changes/ade/`, prepared apart from the CLI and with no GitHub Release before S3. The work is complete when:

- the release tooling accepts ADE intents and every test under `scripts/release` passes, intents without a target included;
- CLI preparation ignores ADE intents;
- one ADE preparation has written `0.2.0` to every ADE manifest with its release notes and tagged `ade-v0.2.0`.

### S1.4c progress

S1.4c lands in three pull requests, because its events need event schema 10, and every reader must read a version before a writer selects it.

1. **Readers and the target (#354, v0.44.0).** The CLI, the Node, and the Hub read schema 10, and `lervo upgrade` targets it.
   - On 2026-11-23 the WSL Hub was deployed by hand from v0.44.0 and reported schema versions 1 to 10.
   - A registered repository on the WSL host then activated schema 10.
2. **Hooks and writers.**
   - The Claude adapter declares `hooks` and passes a session-scoped settings file with Lervo's `SessionStart` and `SessionEnd` handlers.
   - `lervo workspace start` and `lervo workspace open` record `application.workspace.started` and `terminal.session.launch_prepared` in the registered repository's store.
   - `lervo workspace hook` records `launched` and `ended`.
   - Writers check the selected writer version, never the CLI version, and record nothing below schema 10.
3. **The session host's exit report.** When a provider process exits without `SessionEnd`, for example after a crash or SIGKILL, the session host reports the exit through the core link. The core then records `terminal.session.ended` with `process_exited` and the exit code.
   - **3a, the core.** It answers `session.exited`, advertises it in `workspace.list`, and records the end unless the hook already did.
   - **3b, the session host.** It ends a provider process with SIGTERM before SIGKILL, so the provider runs its `SessionEnd` hook. It then reports the exit to a core that advertises `session.exited`. This is the first change under the ADE's own version line.

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
