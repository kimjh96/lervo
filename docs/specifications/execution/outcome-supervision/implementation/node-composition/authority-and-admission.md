# Authority and admission

Authority observation revalidates the selected version 3 writer, event integrity, canonical workstream revision, current team membership, active agent ancestry, role sources, capability ceilings, paths, and providers. It rereads the installation after observation and rejects authority that is revoked, expired, changed, future-dated, or older than five seconds.

Version 1 is unavailable on Hub-enabled repositories. Version 2 requires the exact [designated execution host](../execution-host.md); reader capabilities and transport health do not prove converged history. Stock Node startup preserves the repository-selected writer version instead of reopening the event store at the default version.

## Application evidence and digests

The application supplies planning, effect inspection, execution, attention reporting, and time. It may supply task snapshots, admission facts, and readiness. Omitting those ports selects the canonical managed-task readers in [task observation](../managed-execution/task-observation.md).

The application task digest must cover relevant graph, capacity, budget, and task sources. The factory combines it with the verified authority digest. Proposals use the combined digest; application snapshot, admission, and readiness ports supply the original task digest. Authority changes invalidate plans even when task sources are unchanged. Admission reads application facts before rechecking authority and preserves negative application evidence.

Node verifies the exact responsibility and its fit within the plan before translating a detached readiness observation to the combined digest. Dispatch, retry, and owner execution obtain another readiness observation before final authority admission, then evaluate freshness and checks. The [readiness contract](../readiness.md) defines capability-derived minimum checks and the application's remaining canonical-source and probe responsibilities.

## Execution preflight

Every execution preflight reads the [canonical workforce and actual Git worker workspace](../repository-readiness.md). Changed assignments, leases, ancestry, or workspace ownership invalidate positive adapter claims. Unsupported workspace hosts and absent observations remain blocking. Preflight neither starts a provider nor activates a writer.

Optional trusted `runtimeReadiness` configuration supplies [provider and verification-tool executable observations](../runtime-readiness.md). Missing configuration blocks execution readiness; successful version probes only supplement positive application evidence.

A final Node preflight failure occurs before invoking the concrete effect adapter. The adapter reports `SupervisionPreflightError`; the controller returns `blocked` with `supervision_preflight_failed` and retains the original `recorded` decision. It records no uncertain execution receipt, settles no usage, and creates no replacement plan. Attention reporting receives only the bounded failure code; the internal cause and host details are not persisted there.

After environment repair, including a restart, the existing decision still requires independent `not_started` effect inspection, current authority, and fresh readiness before execution. An unavailable inspector continues to block replay. Errors from the concrete effect or its receipt recording retain the existing uncertain-effect contract. No new event or persistent state is added.
