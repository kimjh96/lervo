# ADR-0032: Project verification in `lervo run`

Status: `accepted`
Decision date: 2026-08-19

## Context

`@lervo/verification` could safely execute suites and create artifacts, but `lervo run` always reported `not_run`. Provider-observed commands are process telemetry, not evidence that project-required verification passed. Running verification in CLI after completion would make `run.completed` premature; implementing process control inside orchestrator would mix concerns.

## Decision

### Explicit suite selection

- Public `lervo run` requires one or more `--verification <suite-id>`, at most 16, with no duplicates. Execute by suite-ID order.
- Init creates an empty suite directory and implies no default verification.
- Load and validate every requested suite immediately after storage opens and before provider start. Missing/invalid suites prevent execution.
- The fixed developer role's `verification.suiteIds` must exactly match the request.

### Separate execution from orchestration

- A small CLI adapter composes suite loader, shell-free runner, snapshots, and artifact store.
- Orchestrator depends only on `ManagedProjectVerifier`; `@lervo/verification` knows no CLI, provider, or event store.
- Order: provider stop → post-run snapshot → provider-result CAS verification → project verification → run completion.
- The verifier binds to the post-run revision and confirms the same state immediately before/after suite execution.
- Orchestrator revalidates result semantics, suite ID/hash, revision, result artifact media/hash/ID/URI/size/canonical bytes, and every stdout/stderr artifact.

### Events

Immediately before each suite, record `verification.started` with suite ID/hash and repository revision. After complete source verification, record `verification.completed` with verification/suite identity, revision, terminal status, result artifact ID/hash, and non-passing command IDs.

Require content-addressed result artifact IDs. Exclude command/arguments, stdout/stderr, environment names/values, absolute paths, provider result, and task.

`run.completed` requires provider/result artifacts plus `verificationStatus`. Public CLI completes only with `passed` for every suite. Only internal backward-compatible coordinator calls without suites may retain `not_run`.

### Failure

With developer `failureDisposition=fail_run`, any non-passing suite first records its completed result, then emits `run.failed` with `verification_failed`; never `run.completed`. Cancellation remains cancelled. Verifier exceptions, missing results, schema/suite/revision mismatch, or CAS tampering also fail verification. After a started event, never infer completed without a verified result source. Orphan CAS objects are not completion evidence.

Suite definitions and output are local sources. Events/errors expose only IDs, states, and hashes. Environment values never enter results. Hub output transfer is outside this decision and remains disabled without separate policy.

## Consequences

Both providers share one verification boundary. Completion cannot precede verification, forged result states/coordinates cannot pass, and execution, orchestration, events, and CLI presentation stay separated.
