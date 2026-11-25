# ADR-0201: Repository-scoped workstream replication

Status: `accepted`
Date: 2026-08-24
Amended by: [ADR-0526](../../execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md) (the default-branch workstream is the replicated lineage), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (divergence reconciles to the newest valid head without the owner)
Amended by: [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md), [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md), [ADR-0527](workstreams/0527-replicate-workstreams-by-lineage.md)

## Context

Local workstream checkpoints let new agent sessions resume without a named handoff file. Other authorized repository nodes need the same bounded continuation state, but repository event histories are single hash chains, and user approvals must not become portable authority.

## Decision

- The Hub stores append-only workstream snapshot revisions under `projectId + repositoryIdentityHash`, independently of publishing destinations. Registration authorizes access but does not define shared repository identity.
- Each Node event producer uses a distinct destination coordinate because `destination + project` retains one canonical event chain. Multiple destinations for one repository identity may read and publish the same workstream.
- After registration, Node reads the bounded Hub head set. If a disclosed head matches local ancestry, Node publishes only the missing local suffix in ancestry order. Without a proven match, it safely republishes every locally available revision. Content hashes bind canonical snapshot JSON; retries are idempotent.
- A new child advances one head. Concurrent children preserve multiple heads, capped at 16. Hub and Node never automatically select or merge divergent heads.
- A distinct workstream can advance a single completed head when its revision is 1 and its `successor` origin names the exact predecessor workstream ID and snapshot hash. The Hub requires that predecessor to be the current head; publication replaces it instead of creating an unrelated branch. Later revisions retain the successor origin. Node imports a unique successor only when its completed local head matches that origin. The source snapshot and prior event history remain canonical locally; transport carries only bounded successor coordinates.
- After publishing local state, Node imports a newer unique Hub head through a durable repository operation: store exact snapshot bytes in local CAS, update the lazy projection, and record a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.
- Replication transfers only the bounded workstream snapshot. It excludes legacy source bytes, prompts, transcripts, credentials, approval grants, signatures, and provider reasoning. `pendingApprovals` remain unresolved descriptions and confer no authority.
- Hub credentials require project scope and separate `workstream.read` and `workstream.write` permissions. Node health reports replication as ready, unavailable, or `divergent_heads`, independently of event sync and remote control.

## Failure semantics

- Invalid hashes, identities, origins, revision gaps, unknown parents, or missing registrations fail closed.
- An active or non-head predecessor, falsified successor coordinate, or unique remote successor unrelated to the completed local head fails closed. A separate root without the successor link remains a divergent head.
- A lost response may be retried: exact content-addressed publication returns `duplicate`.
- Divergence remains visible and blocks import. It is not a transport failure. As amended by ADR-0561, the [checkpoint reconciliation](../../../specifications/coordination/workstream-checkpoint-reconciliation.md) keeps the newest valid head and preserves the other without a user choice.
- Hub integrity audit revalidates snapshot schemas and hashes, ancestry, origins, registrations, derived heads, and append-only triggers.

## Consequences

Fresh authorized nodes can acquire current continuation state without a bookkeeping command. Git Markdown remains canonical for durable product knowledge; replicated workstreams remain mutable operational state. Local execution continues without the Hub.
