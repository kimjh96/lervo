# ADR-0032: Project verification in `lervo run`

- Status: accepted
- Decision date: 2026-08-19

## Context

`@lervo/verification` could safely execute suites and create artifacts, but `lervo run` always reported `not_run`. Provider-observed commands are process telemetry, not proof that required project verification passed.

Running verification in the CLI after completion would make `run.completed` premature. Moving process control into the orchestrator would mix execution and orchestration concerns.

## Decision

### Explicit suite selection

- Public `lervo run` requires one or more `--verification <suite-id>` values, with no duplicates and a maximum of 16. Suites execute in suite-ID order.
- Initialization creates an empty suite directory and implies no default verification.
- Every requested suite is loaded and validated immediately after storage opens and before provider start. Missing or invalid suites prevent execution.
- The fixed developer role's `verification.suiteIds` must exactly match the request.

### Separate execution from orchestration

A small CLI adapter composes the suite loader, shell-free runner, snapshots, and artifact store. The orchestrator depends only on `ManagedProjectVerifier`; `@lervo/verification` knows nothing about the CLI, providers, or event store.

Execution order is provider stop, post-run snapshot, provider-result CAS verification, project verification, then run completion.

The verifier binds results to the post-run revision and confirms the same state immediately before and after suite execution. The orchestrator revalidates result semantics; suite ID and hash; revision; result-artifact media, hash, ID, URI, size, and canonical bytes; and every stdout and stderr artifact.

### Events

Immediately before each suite, record `verification.started` with the suite ID, suite hash, and repository revision. After complete source verification, record `verification.completed` with the verification and suite identities, revision, terminal status, result-artifact ID and hash, and non-passing command IDs.

Result artifact IDs must be content-addressed. Events exclude commands and arguments, stdout and stderr, environment names and values, absolute paths, the provider result, and the task.

`run.completed` requires provider and result artifacts plus `verificationStatus`. The public CLI completes only when every suite has `passed`. Only internal, backward-compatible coordinator calls without suites may retain `not_run`.

### Failure

With developer `failureDisposition=fail_run`, a non-passing suite first records its completed result and then emits `run.failed` with `verification_failed`; it never emits `run.completed`. Cancellation remains cancelled.

Verifier exceptions, missing results, schema, suite, or revision mismatches, and CAS tampering also fail verification. Once a started event exists, completion must not be inferred without a verified result source. Orphan CAS objects are not completion evidence.

Suite definitions and output are local sources. Events and errors expose only IDs, states, and hashes. Environment values never enter results. Hub output transfer is outside this decision and remains disabled without separate policy.

## Consequences

Both providers share one verification boundary. Completion cannot precede verification, and forged result states or coordinates cannot pass. Execution, orchestration, events, and CLI presentation remain separate.
