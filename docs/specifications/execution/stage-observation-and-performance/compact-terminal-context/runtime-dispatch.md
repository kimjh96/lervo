# Detached prefetch and runtime dispatch

After recording a matched Stop observation, `terminal-stop-hook.ts` requests detached `prefetch-context` when `LERVO_TERMINAL_HOOK_RUNTIME` is present and `LERVO_TERMINAL_CONTEXT` is not `retrieval`. This request is independent of the queued-knowledge-job condition and precedes the worker completion-blocking branch. Detached `knowledge-worker` is requested when a knowledge job was queued or owner turns wait for capture. Unmatched and re-entrant Stop return earlier, before these requests.

Prefetch captures a fresh repository snapshot and concurrently obtains its knowledge snapshot ID and computes the private repository health projection. Health reads existing state and bounded event pages without a provider or lint call. The CLI resident also refreshes health after every observation, including skipped and failed cycles. Background workstream provenance is bounded to 10,001 typed events and never
recovers missing state. Publication requires an unchanged repository snapshot
revision and the latest per-checkout generation; generation checking and atomic
rename share one transaction. A launch request does not prove child execution, completion, or a subsequent cache hit.

Before any dispatch, `terminal-hook-bin.ts` verifies its own byte count and SHA-256 and the required adjacent manifest values. Its predicate permits additional manifest keys. Integrity failure sets exit code 2.

- `prefetch-context` runs from the process working directory and suppresses prefetch rejection.
- `knowledge-worker` invokes the worker command with `--once` plus remaining arguments.
- Ordinary hook dispatch sets `LERVO_TERMINAL_HOOK_RUNTIME` and delegates to the terminal command. Its query-provider port uses the production projector, invoked only in opt-in retrieval mode. After the command completes, the executable flushes stdout and exits so abandoned asynchronous handles cannot extend the hook wait. Receipt writes, stage persistence, and storage closes are awaited on the successful path. Worker launches await `spawn` or `error` before returning, within the observation deadline; they do not wait for worker completion. Deadline races can abandon in-flight I/O, so timeout output is not a guarantee that every pending write completed. Detached maintenance has a separate process and is not terminated by this exit.

These source facts establish control flow and cache behavior, not installed latency, a passing performance cohort, successful detached execution, packed-consumer smoke, or publication.
