# ADR-0045: Hub-owned time/scope for policy authoring and HTTP sync

Status: `accepted`
Decision date: 2026-08-19

## Context

Nodes could verify/store policy bundles, but Hub lacked authoring, durable source, and transport. Client-selected approval times/subjects could be forged or reused across projects, while combining HTTP, signing, and SQLite would entangle policy semantics with delivery/UI.

## Decision

### Separate authoring and storage

- `@lervo/hub-policy` knows only `HubPolicySourceStore` plus injected purpose-specific signer.
- Create snapshot only as next head; bind approval to current head and durable command/signer; bind revocation to existing approval.
- HTTP bodies cannot choose issue/approval/revocation/publication times. Use one Hub clock instant.
- Store approver only as SHA-256 of project identity, NUL, and principal ID, making it project-specific.

### Durable append-only Hub source

- Add strict snapshot/approval/revocation tables to Hub SQLite with foreign keys to registration, snapshot, command, and approval plus update/delete guards.
- Separate codecs, reads/audits, and writes from event/trace/command storage.
- Exact canonical replay is duplicate; same ID/sequence with different source conflicts. Approve only current head/stored command; cap approvals and revocations at 64 per snapshot.
- Full audit rechecks snapshot chain and every command hash/signer/time/path/revocation relation.
- Bundle read gives an empty node latest snapshot, a known old cursor exactly next sequence, and current-head cursor the same snapshot so new approvals/revocations arrive. Unknown cursor conflicts rather than skipping ahead.

### Authenticate/authorize before source access

- Bearer principals have separate `trace.read`, `policy.read`, `policy.write` permissions.
- Check identity, project scope, and permission before reading body/source.
- POST snapshot/approval/revocation and GET bundle accept only schema fields with fixed errors, no-store, default 256 KiB request and 1 MiB response limits.
- Node `AuthenticatedPolicyHttpTransport` requires credential/query/fragment-free HTTPS by default, bearer GET, 15-second abort, JSON/content bounds, `x-lervo-hub-identity`, and exact project/destination/identity. Test fixtures alone may explicitly allow HTTP. The header supplements, never replaces, TLS.

Hub stores signed rules, command/hash/signer coordinates, paths, scoped subject hash, and bounded revocation code—not principal, bearer, prose, raw request, payload, or exceptions.

HTTP maps unauthenticated 401, forbidden 403, absent registered sources 404, invalid input 400, identity/head/capacity conflicts 409, and oversized body 413. Node maps Hub identity mismatch to `transport_authentication_failed` and other network/body failures to `hub_unavailable`, preserving current policy. Add no event. `published` means durable Hub commit only, never node loaded/injected/used/executed. Local allow/deny remains Hub-free.

HTTP/SQLite/Ed25519 fixtures cover permission isolation, persisted authoring and restart, Node sync/revocation, destination isolation, concurrent head conflict, cursor rules, bounds, identity mismatch, rejected client timestamps, append-only enforcement, privacy, and full relationship audit.

## Consequences

Authoring, durable source, authorization, and Node transport now sit behind provider-neutral policy contracts. Channel gateways reuse these application boundaries without entering policy core.
