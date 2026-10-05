# Detached prefetch and runtime dispatch

After recording a matched Stop observation, `terminal-hook-command.ts` requests detached `prefetch-context` when `LERVO_TERMINAL_HOOK_RUNTIME` is present and `LERVO_TERMINAL_CONTEXT` is not `retrieval`. This request is independent of the queued-knowledge-job condition and precedes the worker completion-blocking branch. Detached `knowledge-worker` is requested when a knowledge job was queued or owner turns wait for capture. Unmatched and re-entrant Stop return earlier, before these requests.

Prefetch captures a fresh repository snapshot and obtains its knowledge snapshot ID, allowing conditional cache publication for the next prompt. A launch request does not prove child execution, completion, or a subsequent cache hit.

Before any dispatch, `terminal-hook-bin.ts` verifies its own byte count and SHA-256 and the required adjacent manifest values. Its predicate permits additional manifest keys. Integrity failure sets exit code 2.

- `prefetch-context` runs from the process working directory and suppresses prefetch rejection.
- `knowledge-worker` invokes the worker command with `--once` plus remaining arguments.
- Ordinary hook dispatch sets `LERVO_TERMINAL_HOOK_RUNTIME` and delegates to the terminal command.

These source facts establish control flow and cache behavior, not installed latency, a passing performance cohort, successful detached execution, packed-consumer smoke, or publication.
