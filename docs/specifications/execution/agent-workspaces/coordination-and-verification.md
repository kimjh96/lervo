# Hub coordination, events, boundaries, and verification

## Hub-coordinated mode

Hub coordination is optional. `local_first` is the default, requires no Hub, and invokes no Hub port. `hub_coordinated` explicitly enables cross-Node scheduling. Before provisioning or writer renewal, a Node obtains a Hub reservation and then the shared local lease. The Node reconciles privacy-bounded lifecycle summaries and publishes an independent health component.

Reservation scopes use local path normalization and transport hashes; exact and ancestor overlaps conflict. Fencing binds repository identity, scope, target digest, lease generation, and bounded expiry. Same-content retries are idempotent; changed content under one idempotency key conflicts. Reservations grant no repository write, merge, approval, provider, or cleanup capability.

V1 permits at most 128 normalized expected paths and leases from 5 seconds through 30 minutes. Hub reservations use the same expiry and cannot outlive the local lease. Policy `workspace-coordination-v1` permits 32 active reservations per project coordinate and 128 current terminal summaries retained for 30 days. Capacity rejection never evicts an active reservation; values are not inferred from database capacity.

Hub loss behavior:

- `local_first`: execution continues; health may report unavailability.
- `hub_coordinated` before claim: do not start the writer.
- After claim but before expiry: managed gates may continue until recorded expiry under local policy.
- Expired or superseded reservation: freeze new writes and automatic integration; preserve the workspace for revalidation and a higher generation.

Authorized readers may see reservation conflicts and workspace summary status. Summaries preserve checkpoint pause and later activation as distinct monotonic states; they do not turn liveness into writer authority. Hub cannot invoke cleanup. A Node may react to Hub-visible integration only through its own exact local cleanup plan.

## Events, privacy, and claims

Canonical local events and Hub audit transitions are defined in [execution events and privacy](../events-and-privacy.md). Payloads are allowlisted. Owner-only state retains local paths and branches; public status exposes only bounded reason codes and counts.

`agent.workspace.checkpointed` records workspace and assignment IDs, exact revisions and generations, writer-session ID, head and tree hashes, changed-path-set digest and count, clean flag, event ID, and time. It excludes paths, source bytes, prompts, provider output, commands, and errors. It proves only that worker Stop validated and checkpointed the exact writer, lease, workspace revision, and scoped path set. Failure to record it durably blocks worker completion without advancing workspace state.

| Claim | Evidence boundary |
| --- | --- |
| provisioned | A matching checkout was observed |
| active | The local lease authorized that generation at transition time |
| checkpointed | Exact writer, lease, revision, and scoped paths were validated |
| sealed | An immutable verified integration candidate exists |
| integrated | Exact source heads entered the verified target |
| cleanup eligible | Current predicates passed inspection |
| removed | Registered checkout and Git metadata were absent after non-force removal |
| Hub reserved | One Hub scheduler granted bounded coordination |

Claims do not prove provider understanding, semantic correctness, deployment, branch deletion, remote publication, or absence of unmanaged processes beyond adapter evidence.

## Responsibility boundaries

- `@lervo/agent-workforce`: pure assignment, lease, workspace-transition, integration-order, and cleanup-eligibility decisions; no Git, Orca, Hub, filesystem, or provider calls.
- `@lervo/project-storage`: common-directory discovery, owner-only storage, migration, locks, transactions, and recovery journals; no lifecycle eligibility decisions.
- `@lervo/orchestrator`: workforce, host-port, verification, event, and rollback composition; no adapter or Hub policy reimplementation.
- `@lervo/schemas` and `@lervo/event-contract`: additive contracts and redaction allowlists.
- CLI entrypoints: parsing, plan rendering, and exit codes; no Git or cleanup policy.
- Git and Orca: one host adapter each under the common contract; introduce Orca only with its first production caller.
- `@lervo/node-runtime`: optional reservations plus local claims and separate health; Hub HTTP, authentication, and persistence remain within Hub boundaries.

These boundaries keep the lifecycle provider-neutral and prevent CLI, Node, or Orca from becoming the source of assignment or cleanup policy.

## Required verification

- Shared Git and Orca host-adapter contract tests, including idempotent lost-response recovery.
- Sibling-worktree tests for one scheduler and concurrent disjoint leases.
- Shared-checkout and second-writer isolation tests without foreign workstream advancement.
- Seal tests for dirty, untracked, out-of-scope, stale-lease, failed-verification, and no-change cases.
- Deterministic integration ordering, dependencies, stale targets, collisions, conflict abort, rollback, and full verification.
- Cleanup protection, process liveness, symlinks, marker drift, stale plans, non-force removal, crash recovery, event rollback, and exact reachability.
- Hub overlap, generation fencing, expiry, idempotency, permissions, redaction, connectivity loss, and no-remote-cleanup.
- Local operation without Hub, workstream-divergence separation, event schema, documentation, migration, and knowledge-lint gates.
