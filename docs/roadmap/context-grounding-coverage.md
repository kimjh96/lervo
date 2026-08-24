# Managed Context Grounding and Coverage

Status: `complete`
Recorded: 2026-08-24
Completed: 2026-08-24

## Objective

Make every managed run explain which repository documents were selected, loaded, delivered, and explicitly referenced; why each transition occurred; and where evidence is missing. Delivery must never become a claim of model understanding or use.

## Current baseline

- E1 records policy selection with `documentId`, `reasonCode`, `ruleId`, required status, and scope.
- E2 records exact current content hash, byte count, scope, and source revision.
- E3 records adapter acknowledgement of the exact controlled-input envelope, provider session, target turn, and context generation.
- The write gate requires a current E1 -> E2 -> E3 chain for every required document.
- The `referenced` contract existed without a complete provider-bound E4 producer in Codex and Claude adapters.
- Work outside a Lervo-managed lifecycle is `unmanaged` and has no managed context-coverage claim.
- ADR-0197 separately reconstructs unmanaged preparation and exact final-output token references. It leaves managed delivery and internal use unsupported and cannot satisfy this roadmap's E1-E4 criteria.

E3 proves delivery of exact bytes as controlled model input—not attention, understanding, agreement, or internal use. Internal states remain `unknown` unless future provider telemetry independently verifies them.

## Required report

One provider-neutral run-context report appears in local trace output and the Hub trace read model. It includes:

- every observed document and its highest valid evidence level;
- every selection reason and policy rule identifier;
- hashes, scopes, source revisions, envelope receipts, turns, and context generations where applicable;
- explicit references bound to a source event and exact injected version;
- missing stages and controlled failure reasons;
- `managed` or `unmanaged` run status;
- capability flags distinguishing unsupported telemetry from supported telemetry with no observation.

The report is rebuilt from canonical execution events and content-addressed evidence. Event payloads exclude raw prompts, document bodies, unrestricted provider output, credentials, and absolute paths.

## Coverage definitions

Metrics remain separate and use unique document versions, not event counts.

| Metric | Definition | Availability |
|---|---|---|
| Delivery coverage | Required current document versions with valid E3 / required current document versions | Required for managed writes |
| Reference coverage | Injected current document versions with validated E4 / injected current document versions | Nullable until the provider supplies verifiable reference evidence |
| Relevance coverage | Reviewed expected document versions selected / reviewed expected document versions | Available only with reviewed ground truth |
| Candidate selection ratio | Selected candidates / discovered or recommended candidates | Diagnostic only; never relevance coverage |

Never combine these values. A missing or unknowable denominator yields `null` with a reason, not zero or an inferred percentage. Successful managed writing requires 100% delivery coverage but implies neither complete reference nor relevance coverage.

## Reference evidence boundary

Create E4 only from a provider-native structured result or another verifiable provider event. Each reference binds:

- run, session, provider session, and source event;
- document ID and exact E3 content hash;
- reference kind, such as output citation, tool decision, or verification;
- a bounded citation or source coordinate validated against the injected version.

Citation instructions are not evidence. Lervo validates returned references before E4 promotion. Tool and command digests without verifiable document-version binding remain ordinary telemetry.

## Acceptance criteria

- Managed Codex and Claude runs produce the same versioned report shape.
- A trace reconstructs E1-E4 without conversation history.
- Every selected document shows every recorded selection reason.
- Stale hashes, stale generations, missing receipts, unsupported reference telemetry, and unmanaged execution remain distinguishable.
- The delivery denominator matches the write gate's required-document set; a permitted write reports complete delivery.
- Reference and relevance remain nullable and are never fabricated.
- Adapter common-contract, schema, redaction, trace compatibility, and failure-path tests pass.
- Local and Hub traces produce the same semantic result from the same event history.

## Out of scope

- Claims that a model internally understood or used a document.
- Promoting provider-hook sessions into managed execution. ADR-0196 intercepts prompts and stop attempts; ADR-0197 models separate unmanaged evidence. Neither enters managed coverage.
- A combined quality score for delivery, reference, retrieval relevance, or verification.

## Completion evidence

- ADR-0198 defines enhanced E3, structured result capture, exact-token E4, privacy, failures, and projection.
- `@lervo/context-coverage` is the single local and Hub projector.
- Codex and Claude materializers share the evidence-token contract; the orchestrator validates their common `AdapterTurnResult` before E4.
- Current-envelope E4 comments remain in captured source but are removed from the separately hashed human-facing artifact before evaluation and CLI display.
- Schema, redaction, adapter, stale-chain, local trace, Hub parity, and provider lifecycle tests cover the contract.
- The [managed context grounding acceptance pilot](../evidence/pilots/managed-context-grounding.md) passed real local Codex and Claude runs with 1/1 delivery and explicit-reference coverage, no missing stages, functional and publication verification, and token-free displayed output.

See [ADR-0198](../decisions/execution/providers/0198-managed-context-grounding-and-coverage.md).
