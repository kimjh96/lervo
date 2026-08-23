# ADR-0007: Provider-neutral context delivery and E3

Status: `accepted`
Decision date: 2026-08-18

## Context

`@lervo/context` safely selects and reads documents through E2 but does not deliver them to a provider. Letting each Codex or Claude implementation decide inline versus CAS transport, writing-policy inclusion, receipt semantics, and generation invalidation would fragment the contract. Conversely, adding adapter and CAS responsibilities to the context router would mix selection, source lifecycle, and provider execution.

E3 must prove that the exact E2 document set entered a managed session's controlled input. An adapter call alone is insufficient, and one aggregate receipt cannot double as every document's unique evidence receipt.

## Decision

### Boundary and envelope

- `@lervo/context-delivery` builds a provider-neutral envelope from `LoadedContext` and validates the receipt.
- It depends only on a `(session, envelope) -> receipt` port and provider-neutral semantics from `@lervo/adapter-contract`, shared with the common contract suite.
- `@lervo/context` retains E0–E2 integrity and snapshot ownership. Events, capability gates, provider processes, and compaction signals remain with the orchestrator or adapter.
- Validate E2 first, then require session project/run/session/role coordinates to match.
- Resolve the writing policy as a binding of policy ID, document ID, and E2 content hash. Its UTF-8 JSON must satisfy `WritingContract` and carry the session's policy ID.
- Inline documents no larger than 64 KiB when UTF-8 round-trip is exact. Allow policy replacement through a document-metadata function.
- For CAS, use a narrow `put/get` port and verify returned URI, digest, byte count, and read-back bytes. Copy bytes and scope only from E2.
- Envelope creation must be no earlier than loading and session start, and the result must satisfy shared adapter-binding validation.

### Freshness and generation

- The caller supplies the current monotonic `contextGeneration`.
- Check generation and file/publication snapshots before envelope assembly, immediately before adapter invocation, and after receipt return.
- Compaction or restart during delivery invalidates the call even if the adapter returns a receipt for the old generation. The M3 adapter/orchestrator converts provider signals into generation changes.
- Snapshot the session and envelope before invoking the adapter. Reject a receipt derived from adapter-mutated inputs.

### Receipt and E3

- One shared semantic validator checks envelope, adapter, project/run/session/role, writing policy, provider session, time, target turn, generation, and `controlledInput=true`.
- Receipt document IDs must be unique and form exactly the envelope set, with matching hash and scope. The writing-policy document is mandatory.
- `acceptedAt` cannot precede session start or envelope creation.
- After all validation succeeds, create all per-document E3 evidence atomically. Each has a unique `receiptId` and links the aggregate `adapterReceiptId`.
- Return no partial E3 set on failure.

### Failures and source protection

Invalid contract shapes, E2 chains, or writing-policy JSON are `contract_validation_failed`. Stale files/publications/receipts/generations or incomplete adapter calls are `required_context_missing`. Missing or failed CAS storage and read-back are `artifact_storage_failed`. One code mapping owns these meanings.

Inline source and CAS bytes exist only in controlled context input or local artifact storage. Events contain IDs, hashes, scope, turn, and generation—not prompts, document bodies, provider payloads, or original adapter exceptions.

## Consequences

- Codex and Claude share one envelope, receipt, and E3 boundary.
- Context selection stays independent of provider lifecycle and transport.
- Writing-policy source receives the same E2-to-E3 guarantees as every required document.
- Stale receipts cannot reopen the write gate after source changes, compaction, or restart.
