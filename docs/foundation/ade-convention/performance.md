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
- The start screen opens with its input card focused, so a person can type at once. The window then redraws the field each time its caret blinks. That redraw is not the ADE's own work, so the visible idle budget applies with no field focused. With the input card focused, the ADE must run no animation and change no DOM while idle.

## Memory

- Caches are least-recently-used by bytes, with a fixed limit per cache.
- Closing a workspace releases its UI state, its decoded segments, and its renderer resources.
- The session host keeps large text as shared byte buffers and offsets, not as copies. Terminal output passes from the PTY to the protocol frame without re-encoding, and the fan-out, the scrollback, and every replay share one buffer per chunk. A broadcast encodes its message once for all subscribers.
- Listeners, subscriptions, and workers are released with their owner.
- A soak test opens and closes workspaces and streams conversations for a fixed number of cycles. Memory must return to its baseline within the budget.

## GPU and rendering

- Window glass comes from the platform's native window material, as the [visual language](../../specifications/execution/product-surfaces/ade-visual-language.md) requires. A CSS `backdrop-filter` is costly on the GPU, so it appears only on short-lived overlays and on the reply card and "Jump to latest" that float over the conversation, and never over a terminal. The interface harness measures scrolling with the floating controls.
- When the OS asks for reduced transparency, or the device is in a low-power mode, glass becomes an opaque surface.

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
- **Deferred heavy content.** Large tool output starts collapsed and loads on demand. Markdown is parsed only for visible items, once per complete item, and once per frame for the streaming one. S1.6c measured the parser below a frame's budget even for a 163 KB message (4.5 ms), so it runs on the main thread; syntax highlighting, when it arrives, is measured the same way before it may join it. The Markdown renderer is its own chunk, loaded right after the interface starts.

## Measurement

A performance harness runs fixed scenarios on the owner's Mac and in WSL:

- idle with the window visible, with and without a focused text field, and idle with the window hidden;
- twenty idle workspaces;
- a conversation with 100,000 items, opened and scrolled;
- streaming at the provider's fastest rate;
- a soak run of repeated workspace opening and closing.

It records CPU, resident memory, JavaScript heap, frame times, long tasks, input latency, and disk writes. The interface's scenarios run in the release shell's webview through `apps/ade/scripts/measure-webview.mjs`, which the S1.6b section of the ADE roadmap describes. WebKit reports no JavaScript heap or long tasks, so the harness reports resident memory and frames over 50 ms instead. Cheap checks, such as bundle and binary size, run on every pull request. The full harness runs before each release, so continuous integration stays inexpensive.

## Budgets

These are the ADE's budgets, including S1's initial targets. Until S1 records a measured baseline, they are targets.

| Measure                                                               | Target                             |
| --------------------------------------------------------------------- | ---------------------------------- |
| Cold start to the start screen                                        | 500 ms                             |
| Keystroke to echo, p95                                                | The next frame (25 ms at most)     |
| UI idle memory                                                        | 150 MB                             |
| Session host idle memory                                              | 30 MB                              |
| Installed size, excluding provider CLIs                               | 20 MB                              |
| Interface JavaScript that the start screen loads, gzip                | 120 KB                             |
| Any interface chunk that loads on first use, gzip                     | 160 KB                             |
| UI CPU, idle with the window visible and no text field focused        | under 0.5% of one core             |
| UI CPU, idle with the window hidden                                   | under 0.1% of one core             |
| Session host CPU with twenty idle sessions                            | under 0.2% of one core             |
| Session host memory per idle session                                  | at most 5 MB                       |
| First paint after opening a workspace with 100,000 conversation items | 100 ms                             |
| Scrolling that conversation                                           | 60 fps; no task longer than 50 ms  |
| UI memory with that conversation open                                 | at most 50 MB above idle           |
| Streamed delta to the page, p95                                       | 33 ms                              |
| Streamed delta to screen, p95                                         | 33 ms plus `motion.duration.pace`  |
| Memory after the soak run                                             | within 5% of the starting baseline |

The launch view counts toward the cold-start budget. It waits for the first lists so the start screen does not fill in after it appears, but it leaves no later than 500 ms after the window's navigation start, whether the lists have loaded or not.

### Revisions after the first baseline

On 2026-11-24 the S1.6b harness showed that three targets measured something besides the interface's own work, so they were revised. The S1.6b section of the [ADE roadmap](../../roadmap/ade.md) holds the measurements. The owner's Mac was busy with other work during those runs, so their CPU and latency figures may read high.

- **Idle CPU with the window visible.** The start screen opens with its input card focused, by design, and a focused field redraws each time its caret blinks.
  - The start screen measured 1.53–1.83% of one core with the focus and 0.03% without it.
  - One focused text field alone in the same window measured 1.57%.
  - A transparent caret, and removing the input card's `backdrop-filter`, left the cost unchanged.

  The target now applies with no field focused. With the input card focused, the ADE must run no animation and change no DOM. Whether the native window material adds to the caret's cost is not measured yet; the next run compares the lone field in an opaque window. Dropping the focus when idle and restoring it on the first keystroke was rejected: it hides the caret that invites typing, and it risks losing the first jamo of Korean input.

- **Streamed delta to screen.** The [motion specification](../../specifications/execution/product-surfaces/ade-motion.md) lets streamed text trail its arrival by up to `motion.duration.pace` (120 ms). The 33 ms target now applies to the page, and the screen's target adds the pace: 153 ms. The harness also checks each delta's trail against the pace plus one frame.
- **Keystroke to echo.** The harness types each key right after a frame, so whenever the interface's work fits in a frame it reads one frame interval, 16.7 ms at 60 Hz, and a 16 ms target could never pass. The target is now the next frame. The harness counts an echo of 25 ms or less, one and a half intervals, as the next frame, because a missed frame reads two.
  - That check misses a slowdown that still fits in a frame, so the harness also reports the interface's work per keystroke.
  - Keystrokes come from the page, so IME composition, such as Korean input, is not measured.
