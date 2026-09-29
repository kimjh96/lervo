# ADR-0442: Isolate conversation repository snapshots

Status: accepted
Decision date: 2026-09-28

## Context

[ADR-0441](0441-isolate-resident-knowledge-from-node-conversations.md) moved the resident
knowledge owner into its own process. The first installed Lervo Node run after that
change still failed `repository_snapshot_failed` after 30,384 ms. Later native Claude
conversation runs completed, but one spent 22,745 ms in its combined snapshot stages.
The same live repository, captured with the installed standalone Node artifact while
the service was busy, took 2.85 seconds. Thus knowledge-worker separation alone does
not remove the conversation event loop's snapshot contention. The recorded failure
was the existing 30-second pre-run deadline, not an observed path-safety rejection.

## Decision

An installed standalone Node runs each managed conversation repository snapshot in a
one-shot child of the same immutable Node artifact. The parent forks with the same
Node executable, physical repository root, and actual owner PID. The internal route
requires its owning IPC channel. Its only request is the existing snapshot policy;
its only successful result is the complete existing `RepositorySnapshot` (revision,
file hashes, and optional Git commits). It exits after sending that result. A parent
disconnect stops read-only capture without writing repository state. Library hosts
without the artifact entry retain the existing cached in-process capture.

The child calls the existing orchestrator capture, preserving no-follow reads, before
and after file identity checks, source limits, exclusions, Git-head fence, and
deterministic revision. The parent accepts a result only from its owned child and
propagates bounded existing snapshot failures. An absent, malformed, or prematurely
closed child fails the existing `repository_snapshot_failed` run stage. The existing
30-second stage deadline and retry policy are unchanged. This route grants no model,
repository write, documentation review, asset, or deployment authority.

## State, privacy, and verification

The child handle and pending result are process-local. There is no new canonical event,
durable state, or successful snapshot claim before the IPC result arrives. IPC carries
repository file paths and hashes already required by the managed snapshot; it carries
no file content, conversation text, provider output, or credentials. Launch, child
exit, or malformed result means snapshot evidence unavailable. A bounded snapshot
error message retains the existing root, read, byte-count, file-count, or coordinate
failure meaning without exposing an arbitrary exception or path.

Verify unowned invocation refusal, parent responsiveness during real child CPU work,
closed-child failure, bounded failure propagation, and equality with an in-process
snapshot on the same unchanged repository. Rehearse the bundled route and installed
canary under actual background work. A fresh human message and successful published
response remain required for installed Discord latency acceptance; transport `ready`
and historical provider completion alone do not satisfy it.

## References

- [Execution specification](../../../../specifications/execution.md)
- [Background convergence roadmap](../../../../roadmap/knowledge/autonomous-background-convergence.md)
