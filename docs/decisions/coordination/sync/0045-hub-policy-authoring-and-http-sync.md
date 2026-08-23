# ADR-0045: Hub-owned time/scope for policy authoring and HTTP sync

Status: `accepted`
Decision date: 2026-08-19

## Context

Nodes could verify and store policy bundles, but the Hub lacked authoring, a durable source, and transport. Client-selected approval times or subjects could be forged or reused across projects. Combining HTTP, signing, and SQLite would also couple policy semantics to delivery and UI concerns.

## Decision

### Separate authoring and storage

- `@lervo/hub-policy` depends only on `HubPolicySourceStore` and an injected, purpose-specific signer.
- Create a snapshot only as the next head. Bind approval to the current head and durable command/signer, and bind revocation to an existing approval.
- HTTP bodies cannot select issue, approval, revocation, or publication times. Use one Hub clock instant.
- Store the approver only as the SHA-256 hash of project identity, NUL, and principal ID, making it project-specific.

### Durable append-only Hub source

- Add strict snapshot, approval, and revocation tables to Hub SQLite, with foreign keys to registration, snapshot, command, and approval and with update/delete guards.
- Separate codecs, reads/audits, and writes from event, trace, and command storage.
- Treat exact canonical replay as a duplicate; reject the same ID or sequence with different source as a conflict.
- Approve only the current head and stored command. Limit each snapshot to 64 approvals and 64 revocations.
- Full audit rechecks the snapshot chain and every command hash, signer, time, path, and revocation relation.
- Bundle reads return: the latest snapshot to an empty node; exactly the next sequence for a known old cursor; and the current snapshot for a current-head cursor so new approvals and revocations arrive. An unknown cursor conflicts instead of skipping ahead.

### Authenticate/authorize before source access

- Bearer principals have separate `trace.read`, `policy.read`, and `policy.write` permissions.
- Check identity, project scope, and permission before reading the request body or source.
- POST snapshot/approval/revocation and GET bundle accept only schema fields, use fixed errors and `no-store`, and default to 256 KiB request and 1 MiB response limits.
- Node `AuthenticatedPolicyHttpTransport` requires a credential-, query-, and fragment-free HTTPS URL by default; bearer GET; a 15-second abort; JSON/content bounds; `x-lervo-hub-identity`; and exact project, destination, and identity coordinates. Only test fixtures may explicitly allow HTTP. The identity header supplements TLS and never replaces it.

The Hub stores signed rules, command/hash/signer coordinates, paths, a scoped subject hash, and a bounded revocation code. It stores no principal, bearer token, prose, raw request, payload, or exception.

HTTP maps unauthenticated to 401, forbidden to 403, absent registered sources to 404, invalid input to 400, identity/head/capacity conflicts to 409, and oversized bodies to 413. The Node maps Hub identity mismatch to `transport_authentication_failed` and other network or body failures to `hub_unavailable`, preserving current policy.

Add no event. `published` means only a durable Hub commit, never node loaded, injected, used, or executed state. Local allow/deny remains Hub-free.

HTTP, SQLite, and Ed25519 fixtures cover permission isolation, persisted authoring and restart, Node synchronization and revocation, destination isolation, concurrent head conflict, cursor rules, bounds, identity mismatch, rejected client timestamps, append-only enforcement, privacy, and full relationship audit.

## Consequences

Authoring, durable source, authorization, and Node transport sit behind provider-neutral policy contracts. Channel gateways reuse these application boundaries without entering policy core.
