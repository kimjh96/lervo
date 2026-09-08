# ADR-0201: Repository-scoped workstream replication

Status: `accepted`
Date: 2026-08-24

## Context

Local workstream checkpoints let new agent sessions resume without a named handoff file. Other authorized repository nodes need the same bounded continuation state, but repository event histories are single hash chains, and user approvals must not become portable authority.

## Decision

- The Hub stores append-only workstream snapshot revisions under `projectId + repositoryIdentityHash`, independently of publishing destinations. Registration authorizes access but does not define shared repository identity.
- Each Node event producer uses a distinct destination coordinate because `destination + project` retains one canonical event chain. Multiple destinations for one repository identity may read and publish the same workstream.
- After registration, Node first reads the bounded Hub head set. If a disclosed head matches local ancestry, it publishes only the missing local suffix in ancestry order. Without a proven match, it safely republishes every locally available revision. Content hashes bind canonical snapshot JSON; retries are idempotent.
- A new child advances one head. Concurrent children preserve multiple heads, capped at 16. Hub and Node never automatically select or merge divergent heads.
- After publishing local state, Node imports a newer unique Hub head through a durable repository operation: it stores exact snapshot bytes in local CAS, updates the lazy projection, and records a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.
- Replication transfers only the bounded workstream snapshot. It excludes legacy source bytes, prompts, transcripts, credentials, approval grants, signatures, and provider reasoning. `pendingApprovals` remain unresolved descriptions and confer no authority.
- Hub credentials require project scope and separate `workstream.read` and `workstream.write` permissions. Node health reports replication as ready, unavailable, or `divergent_heads`, independently of event sync and remote control.

## Failure semantics

- Invalid hashes, identities, origins, revision gaps, unknown parents, or missing registrations fail closed.
- A lost response may be retried because exact content-addressed publication returns `duplicate`.
- Divergence remains visible and blocks import. It is not a transport failure and requires a later explicit reconciliation design or user-authorized choice.
- Hub integrity audit revalidates snapshot schemas and hashes, ancestry, origins, registrations, derived heads, and append-only triggers.

## Consequences

Fresh authorized nodes can acquire current continuation state without a bookkeeping command. Git Markdown remains canonical for durable product knowledge; replicated workstreams remain mutable operational state. Local execution continues without the Hub.
