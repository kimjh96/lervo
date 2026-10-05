# Compact terminal context implementation

This note describes the supplied compact-context implementation and auxiliary runtime dispatch. [ADR-0451](../../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md) owns the compact-mode decision.

## Knowledge snapshot identity cache

`apps/cli/src/terminal-compact-context.ts` stores a knowledge snapshot coordinate at `.lervo/state/cache/terminal-knowledge-snapshot.json`. This is separate from both the repository stat-identity cache and the knowledge lifecycle inspection cache.

The record contains schema version 1, repository revision, project ID, policy ID, and source snapshot ID. Reading catches parse and filesystem failures and requires schema version 1 and a source snapshot ID matching `ksnap_` followed by 24 lowercase hexadecimal characters. Reuse additionally requires equality with the requested repository revision and the loaded project and policy IDs. The reader does not enforce an exact property set.

A miss runs `scanConfiguredRepositoryKnowledge`. Before publishing the cache, another terminal repository snapshot must match the requested revision. Publication creates the parent directory with requested mode `0700`, writes a PID-suffixed temporary file with requested mode `0600`, and renames it to the cache path. Write failures are ignored. These mode arguments do not establish permissions of an already existing directory.

Revision disagreement prevents cache publication; the function still returns the scan's snapshot ID. This guard therefore does not independently prove that every returned scan came from an unchanged repository. The cache contains coordinates rather than source bodies and is not a lifecycle-current receipt.

## Compact assembly

Compact preparation captures the repository snapshot before starting concurrent knowledge-snapshot lookup, deterministic empty projection/workstream loading, canonicalization-candidate listing, and resident-health inspection. Candidate-list failure becomes unavailable coverage. Other failures can propagate to the hook's availability-safe handling.

The deterministic projector reports `empty`, zero queries, and zero projection duration. The returned context has zero recommendations and documents, abstaining grounding, ignored durable-instruction materialization, and selection disposition `query_projection_missing`. It provides no retrieved-document delivery or use evidence.

Workstream text includes a title bounded to 200 bytes, the first next action bounded to 360 bytes, and at most three pending decision questions bounded to 240 bytes each. It includes the total pending-decision count, decision identifiers, blocking markers, and recommended choice identifiers. The workstream evidence hashes the complete snapshot while declaring delivered scope `prefix` and the actual delivered byte count.

The preamble includes at most five blocking attention items, an on-demand knowledge-query instruction, and workstream start/update instructions. It uses background-owned wording when the resident is healthy or the workspace binding identifies a worker; otherwise it includes the supplied declaration instruction. This module applies item bounds but contains no final aggregate context-size check. ADR-0451's size targets require separate verification.

The preamble also carries the owner-turn capture lines of [ADR-0467](../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md): pending instruction candidates and held items, and the titles of applied rules under `docs/instructions/generated/`. Both are read from local files with no provider call. Separately, the hook queues the owner's prompt for background capture under the `event_commit` stage; assignment-workspace sessions are excluded.

## Detached prefetch and runtime dispatch

After recording a matched Stop observation, `terminal-hook-command.ts` requests a detached `prefetch-context` invocation when `LERVO_TERMINAL_HOOK_RUNTIME` is present and `LERVO_TERMINAL_CONTEXT` is not `retrieval`. This is independent of the queued-knowledge-job condition and occurs before the worker completion-blocking branch. The detached `knowledge-worker` request runs when a knowledge job was queued or owner turns wait for capture. Unmatched and re-entrant Stop return earlier and do not reach this request.

The prefetch function captures a fresh repository snapshot and obtains its knowledge snapshot ID, allowing conditional cache publication for the next prompt. A launch request does not prove child execution, completion, or a subsequent cache hit.

`terminal-hook-bin.ts` verifies its own byte count and SHA-256 and the required adjacent manifest values before any dispatch. Its predicate does not reject additional manifest keys. Integrity failure sets exit code 2. The `prefetch-context` branch runs from the process working directory and suppresses prefetch rejection. The `knowledge-worker` branch invokes the worker command with `--once` plus remaining arguments. Ordinary hook dispatch sets `LERVO_TERMINAL_HOOK_RUNTIME` and delegates to the terminal command.

These source facts establish control flow and cache behavior. They do not establish installed latency, a passing performance cohort, successful detached execution, packed-consumer smoke, or publication.
