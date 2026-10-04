# ADR-0442: Isolate conversation repository snapshots

Status: accepted
Decision date: 2026-09-28

## Context

[ADR-0441](0441-isolate-resident-knowledge-from-node-conversations.md) moved the resident knowledge owner into its own process. The first installed Lervo Node run afterward still failed `repository_snapshot_failed` at 30,384 ms. Later native Claude conversation runs completed, but one spent 22,745 ms in combined snapshot stages. Capturing the same live repository with the installed standalone Node artifact while the service was busy took 2.85 seconds. Knowledge-worker separation alone therefore does not remove conversation event-loop snapshot contention. The recorded failure was the existing 30-second pre-run deadline, not an observed path-safety rejection.

## Decision

An installed standalone Node runs each managed conversation repository snapshot in a one-shot child of the same immutable Node artifact. The parent forks with the same Node executable, physical repository root, and actual owner PID. The internal route requires its owning IPC channel. Its only request is the existing snapshot policy; its only successful result is the complete existing `RepositorySnapshot`: revision, file hashes, and optional Git commits. The child exits after sending the result. Parent disconnect stops read-only capture without writing repository state. Library hosts without the artifact entry retain existing cached in-process capture.

The child calls existing orchestrator capture, preserving no-follow reads, before-and-after file identity checks, source limits, exclusions, the Git-head fence, and deterministic revision. The parent accepts results only from its owned child and propagates bounded existing snapshot failures. An absent, malformed, or prematurely closed child fails the existing `repository_snapshot_failed` run stage. The existing 30-second stage deadline and retry policy remain unchanged. The route grants no model, repository write, documentation review, asset, or deployment authority.

## State, privacy, and verification

The child handle and pending result are process-local. No new canonical event, durable state, or successful snapshot claim exists before the IPC result arrives. IPC carries repository file paths and hashes already required by the managed snapshot, with no file content, conversation text, provider output, or credentials. Launch failure, child exit, or malformed result means snapshot evidence is unavailable. A bounded snapshot error message preserves the existing root, read, byte-count, file-count, or coordinate failure meaning without exposing an arbitrary exception or path.

Verify refusal of unowned invocation, parent responsiveness during real child CPU work, closed-child failure, bounded failure propagation, and equality with an in-process snapshot on the same unchanged repository. Rehearse the bundled route and installed canary under actual background work. Installed Discord latency acceptance still requires a fresh human message and successful published response; transport `ready` and historical provider completion alone do not satisfy it.

## References

- [Execution specification](../../../../specifications/execution.md)
- [Background convergence roadmap](../../../../roadmap/knowledge/autonomous-background-convergence.md)
