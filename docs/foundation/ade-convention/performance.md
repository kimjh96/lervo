# Lervo ADE performance and resource use

Status: `proposed`
As of: 2026-11-23

This part of the [Lervo ADE convention](../ade-convention.md) defines how the ADE uses each resource and how it proves it.

Every resource the ADE uses must be at its best: CPU, memory, GPU, disk, energy, processes, and size. Performance is a release criterion. Each slice measures its budgets, and a regression blocks release unless a reviewed budget revision accompanies it.

## Principles

- **Measure before optimizing.** Each optimization starts from a reproducible scenario and keeps a baseline to compare against, as the [code convention](../code-convention.md) requires.
- **Idle means idle.** With no agent working and no user input, the ADE does no work: no polling, no timers, no animation. Every change arrives as an event.
- **Everything is bounded.** Every cache, buffer, queue, index, and log has a size limit in bytes or items and an eviction rule. A collection whose size grows with use needs both before it lands.
- **Work only for what the user sees.** Rendering, parsing, highlighting, and layout run only for visible content. A hidden or occluded window stops rendering work.

## CPU

- File and repository changes arrive through OS notifications, never through polling. Watchers cover only the paths a feature needs.
- Remaining timers are coalesced and stop when the window is hidden. One timer is exempt: the session-host client's reconnect timer, which runs only while the connection is down, at most every 10 seconds. A hidden window still needs the connection, because the session watch behind desktop notifications runs over it.
- The UI main thread does only input, state transitions, and rendering. Parsing, highlighting, and diffing run in workers or in the session host.
- The session host's async workers never block. Each conversation index reads and writes on its own thread, each PTY writes input on its own thread, and starting a session opens its index and spawns its process off the workers. No lock is held across such work, so one slow start or paste never stalls another connection.
- Input-driven work, such as search and resize, is debounced or throttled.
- React renders follow the data they read. Stores expose fine-grained selectors with stable references, and no context change re-renders a whole feature.
- Animations use compositor-only properties (`transform` and `opacity`). They stop when the window is hidden, when the user prefers reduced motion, and when nothing is working. `platform/visibility` marks a hidden, minimized, or occluded window, and `ui/motion.css` pauses every animation while the mark is set.

## Memory

- Caches are least-recently-used by bytes, with a fixed limit per cache.
- Closing a workspace releases its UI state, its decoded segments, and its renderer resources.
- The session host keeps large text as shared byte buffers and offsets, not as copies. Terminal output passes from the PTY to the protocol frame without re-encoding, and the fan-out, the scrollback, and every replay share one buffer per chunk. A broadcast encodes its message once for all subscribers.
- Listeners, subscriptions, and workers are released with their owner.
- A soak test opens and closes workspaces and streams conversations for a fixed number of cycles. Memory must return to its baseline within the budget.

## GPU and rendering

- Window glass comes from the platform's native window material, as the [visual language](../../specifications/execution/product-surfaces/ade-visual-language.md) requires. A CSS `backdrop-filter` is costly on the GPU, so it appears only on short-lived overlays and on the reply card and "Jump to latest" that float over the conversation, and never over a terminal. The interface harness measures scrolling with the floating controls.
- When the OS asks for reduced transparency, or the device is in a low-power mode, glass becomes an opaque surface.
- The CLI conversation uses one WebGL terminal renderer per visible terminal. Hidden terminals keep their buffer but release their renderer.
- Terminal output is written to the renderer at most once per frame, with a per-frame byte limit, so a flood of output never freezes input.

## Disk

- Writes are appended and batched. No write happens per keystroke or per streamed delta.
- Segment and log files have a fixed size, and their retention and compaction rules are defined before they land.
- Startup never scans whole repositories. It reads cached state and refreshes it in the background.
- Crash-safe writes use a temporary file and an atomic rename.

## Energy

- The ADE follows the platform's power hints. It cooperates with macOS App Nap and pauses background refresh while hidden.
- On battery or in low-power mode, deferred work waits and glass turns opaque.

## Processes, protocol, and startup

- Each host runs one session host and one resident Lervo application process. No action starts a new process, apart from the provider CLIs themselves.
- The protocol uses length-prefixed binary frames. Small messages are batched, and large payloads are compressed only on remote transports.
- The session host sends sequenced deltas, never full state. Each client tracks the last sequence it applied and resumes from it.
- A slow client receives backpressure. The session host never buffers without bound for a client: each subscription has 4 MiB for its session's updates, after which the client resynchronizes, and each connection has 16 MiB for replies and watched statuses, after which it closes and the client reconnects. Every queued message counts its exact encoded size.
- The start screen renders from cached workspace state and refreshes after first paint. Features and their code load on first use.

## Size

- The UI bundle and the session host binary have size budgets that every pull request checks.
- Each new dependency states why it is needed and what it costs in size. Fonts ship subset to the scripts the catalogs need.

## Conversations grow without bound

A conversation can grow without limit. No layer may hold or render all of it.

- **Canonical source.** The provider's own transcript stays the canonical conversation. The session host keeps a conversation index of append-only segments with a fixed item count, each with an offset table. The index is a rebuildable projection (invariant 4); deleting it loses nothing.
- **Bounded memory.** The session host keeps the open segment and a bounded segment cache in memory. The UI keeps a bounded window around the viewport and requests older or newer ranges by item sequence number.
- **Virtualized rendering.** The conversation list renders only visible items and a small overscan. Item heights are measured once and cached by item and width.
- **Immutable history.** A completed message never renders again. Only the streaming tail updates.
- **Frame-bound streaming.** Streamed deltas are coalesced to at most one UI update per animation frame.
- **Deferred heavy content.** Large tool output starts collapsed and loads on demand. Markdown parsing and syntax highlighting of history run off the main thread and only for visible items.
- **Bounded scrollback.** The CLI conversation keeps a bounded in-memory ring and moves older lines to segments.

## Measurement

A performance harness runs fixed scenarios on the owner's Mac and in WSL:

- idle with the window visible, and idle with the window hidden;
- twenty idle workspaces;
- a conversation with 100,000 items, opened and scrolled;
- streaming at the provider's fastest rate;
- a terminal flood, such as a build that prints continuously;
- a soak run of repeated workspace opening and closing.

It records CPU, resident memory, JavaScript heap, frame times, long tasks, input latency, and disk writes. Cheap checks, such as bundle and binary size, run on every pull request. The full harness runs before each release, so continuous integration stays inexpensive.

## Budgets

These are the ADE's budgets, including S1's initial targets. Until S1 records a measured baseline, they are targets.

| Measure                                                               | Target                             |
| --------------------------------------------------------------------- | ---------------------------------- |
| Cold start to the start screen                                        | 500 ms                             |
| Keystroke to echo, p95                                                | 16 ms                              |
| UI idle memory                                                        | 150 MB                             |
| Session host idle memory                                              | 30 MB                              |
| Installed size, excluding provider CLIs                               | 20 MB                              |
| Interface JavaScript that the start screen loads, gzip                | 120 KB                             |
| Any interface chunk that loads on first use, gzip                     | 160 KB                             |
| UI CPU, idle with the window visible                                  | under 0.5% of one core             |
| UI CPU, idle with the window hidden                                   | under 0.1% of one core             |
| Session host CPU with twenty idle sessions                            | under 0.2% of one core             |
| Session host memory per idle session                                  | at most 5 MB                       |
| First paint after opening a workspace with 100,000 conversation items | 100 ms                             |
| Scrolling that conversation                                           | 60 fps; no task longer than 50 ms  |
| UI memory with that conversation open                                 | at most 50 MB above idle           |
| Streamed delta to screen, p95                                         | 33 ms                              |
| Input latency during a terminal flood, p95                            | 50 ms                              |
| Memory after the soak run                                             | within 5% of the starting baseline |
