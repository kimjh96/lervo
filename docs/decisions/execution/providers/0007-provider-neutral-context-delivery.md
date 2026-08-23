# ADR-0007: Provider-neutral context delivery and E3

- Status: `accepted`
- Decision date: 2026-08-18

## Context

`@lervo/context` safely selects and reads documents through E2 but does not deliver them to providers. Provider-specific choices for inline versus CAS transport, writing-policy inclusion, receipts, and generation invalidation would fragment the contract. Adding adapter and CAS duties to the context router would instead mix selection, source lifecycle, and provider execution.

E3 must prove that the exact E2 document set entered a managed session's controlled input. An adapter call is insufficient, and one aggregate receipt cannot serve as every document's unique evidence receipt.

## Decision

### Boundary and envelope

- `@lervo/context-delivery` builds a provider-neutral envelope from `LoadedContext` and validates its receipt.
- It depends only on a `(session, envelope) -> receipt` port and provider-neutral semantics from `@lervo/adapter-contract`, shared with the common contract suite.
- `@lervo/context` retains E0–E2 integrity and snapshot ownership. Events, capability gates, provider processes, and compaction signals remain with the orchestrator or adapter.
- Validate E2 first, then require matching session project, run, session, and role coordinates.
- Bind the writing policy by policy ID, document ID, and E2 content hash. Its UTF-8 JSON must satisfy `WritingContract` and contain the session policy ID.
- Inline documents at most 64 KiB when UTF-8 round-trip is exact. A document-metadata function may replace policy metadata.
- CAS uses a narrow `put/get` port. Verify returned URI, digest, byte count, and read-back bytes; copy bytes and scope only from E2.
- Create the envelope no earlier than loading and session start, and require shared adapter-binding validation.

### Freshness and generation

The caller supplies the current monotonic `contextGeneration`. Check generation and file/publication snapshots before envelope assembly, immediately before adapter invocation, and after receipt return. Compaction or restart during delivery invalidates the call even when the adapter returns an old-generation receipt; the M3 adapter/orchestrator converts provider signals into generation changes.

Snapshot the session and envelope before adapter invocation. Reject receipts derived from adapter-mutated inputs.

### Receipt and E3

One shared semantic validator checks envelope, adapter, project/run/session/role, writing policy, provider session, time, target turn, generation, and `controlledInput=true`.

Receipt document IDs must be unique and exactly equal the envelope set, with matching hash and scope. The writing-policy document is mandatory. `acceptedAt` cannot precede session start or envelope creation.

After all validation succeeds, atomically create every per-document E3 record. Each has a unique `receiptId` linked to the aggregate `adapterReceiptId`. Failures return no partial E3 set.

### Failures and source protection

Invalid contract shapes, E2 chains, or writing-policy JSON are `contract_validation_failed`. Stale files, publications, receipts, generations, or incomplete adapter calls are `required_context_missing`. Missing or failed CAS storage or read-back is `artifact_storage_failed`. One code mapping owns these meanings.

Inline source and CAS bytes exist only in controlled context input or local artifact storage. Events contain IDs, hashes, scope, turn, and generation—not prompts, document bodies, provider payloads, or original adapter exceptions.

## Consequences

- Codex and Claude share one envelope, receipt, and E3 boundary.
- Context selection remains independent of provider lifecycle and transport.
- Writing-policy source receives the same E2-to-E3 guarantees as every required document.
- Source changes, compaction, or restart prevent stale receipts from reopening the write gate.
