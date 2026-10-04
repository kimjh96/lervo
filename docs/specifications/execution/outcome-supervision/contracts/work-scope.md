# Reviewed goal scope

Operating mandate version 3 binds a new bounded goal within a long-lived workstream. It retains the designated execution host and adds an exact reviewed `workScope`; it does not reconcile device histories. Versions 1 and 2 retain workstream-wide task and resource semantics. Successor authority version 2 can set a stable per-successor aggregate ceiling independently of a larger reviewed ceiling for the running goal.

## Authority and historical work

`workScope` requires `schemaVersion: 1`, `workstreamId`, `snapshotEventId`, `snapshotEventHash`, and `excludedAssignments`. The anchor must be the exact canonical snapshot event for the same project and workstream. Exclusions must be unique, number at most 256, and each pin an `assignmentId` and its complete current assignment `contentHash`.

Each excluded assignment must have completed or failed before the anchor, retain no lease or handoff, and have neither a supervised responsibility binding nor topology provenance. Every prior assignment must be explicitly covered; dependencies must not cross the historical boundary. Observation and installation reject changed, missing, active, supervised, or undeclared prior assignments. All prior causal work, including every recorded descendant, must be terminal before the anchor. Pending or uncertain supervision decisions at the anchor reject the scope.

`lervo agent mandate scope` validates every canonical snapshot from newest to oldest and returns the newest scope the exact validator admits, automatically pinning eligible terminal assignments. Unresolved assignments, causal runs, supervision decisions, or dependency boundaries make later snapshots ineligible; selection may return a snapshot before that work was created. If no safe snapshot exists, selection fails without guessing, settling work, or widening authority. Generated scope is review input and grants nothing until included in an approved mandate installation.

Planning and applying a later revision of an installed V3 mandate both observe the workstream pinned by that mandate's `workScope`, not the currently projected repository workstream. Both use the same pinned coordinate. An unrelated current workstream cannot make an exact historical anchor appear missing or redirect revised authority to itself.

Scope review identifies prior tasks outside the new goal. It does not turn failure into acceptance, prove unobserved historical provider work, repair unavailable telemetry, or remove any assignment, event, artifact, or resource observation. Legacy terminal records without managed execution evidence remain unmanaged. Historical resource reports retain their original scope and may remain incomplete or invalid.

Exact `pathRoots: ["*"]` represents reviewed repository-wide scope, bounded to normalized repository-relative paths. It never admits absolute paths, parent traversal, or filesystem escape. Narrow roots retain existing prefix semantics.

## New goal accounting and completion

The new goal contains assignments created after the anchor. Its aggregate budget includes every causal work tree rooted after the anchor in the workstream, including owner reasoning, retries, workers, and evaluation descendants. Selecting a root never truncates descendants. Existing provider, accounting-descriptor, scope, missing-usage, reservation, and admission checks still apply. The bounded goal total is not a lifetime workstream total.

An exhausted V3 envelope blocks only the next supervised effect for that goal; it neither degrades the Node process nor resets itself. A reviewed mandate revision may add capacity to the same goal while retaining all prior usage and reservation charges. A settled goal may advance through reviewed standing successor authority, whose distinct scope starts a new envelope.

A long-lived repository owner may instead carry reviewed `aggregateTokenPolicy.mode: per_attempt_only`. In this mode, cumulative history and missing historical usage do not block admission. Attempt tokens, retry count, concurrency, worker and assignment capacity, deadline, expiry, provider, role, capability, and path limits apply independently. The legacy numeric aggregate field remains serialized for compatibility but has no admission meaning under this explicit version-3 policy. Derived successors inherit the policy.

Task observation retains the complete assignment set alongside the scoped task set. Before commit, source digests, topology checks, assignment transitions, and goal completion revalidate preserved predecessors. Goal completion applies to the current bounded workstream objective and requires independent acceptance of every current task. Publishing the accepted result requires separate authority.

A successor mandate cannot change or remove an installed scope, even after revocation. A workstream-wide predecessor must be revoked before adopting version 3. A new scope requires a separate reviewed installation. The autonomous owner cannot reset its budget by proposing a later anchor.

## Standing successor authority

Version 3 may carry optional reviewed `successorAuthority` with `maximumSuccessors` from 1 to 1024 ([ADR-0405](../../../../decisions/execution/orchestration/governed-work/0405-standing-supervision-lineage.md)). Both successor authority versions let the installed owner derive one mandate per successor goal without a new review:

- Version 1 preserves the parent's aggregate ceiling for compatibility.
- Version 2 specifies `maximumAggregateTokens` for every derived goal, independently of a larger reviewed ceiling for the running goal. This allows a reviewed increase for one unusually large running goal without granting it to later goals. The successor ceiling cannot be lower than the attempt ceiling and remains immutable across automatic derivation.

Each derived mandate is a separate installation with:

- Supervision and mandate IDs `<parent>.s<n>` and version 1.
- The parent's owner, host, non-aggregate bounds, reviewed successor aggregate ceiling, expiry, and revocation prefix.
- A work scope anchored to the successor goal's start snapshot, with no exclusions.
- `maximumSuccessors` reduced by one or absent.

The installation plan's `derivation` includes the parent installation event, parent mandate hash, and successor index inside the approval hash. Installation recomputes derivation and rejects a widened, re-anchored, re-indexed, or revoked-parent child. Derivation requires the current goal to be settled and always anchors a new workstream; it cannot reset a running goal's budget.

## Failure, privacy, and verification

The existing exact mandate installation artifact and event bind the scope. No new event type or credential field is introduced. Events retain existing mandate and review hashes. The artifact contains only bounded opaque assignment and event coordinates and hashes; it must exclude task prose, source bodies, provider output, and credentials.

Invalid or stale scope observations prevent admission and use the existing unavailable-supervision health and failure boundary.

Pure tests cover preserved failed predecessors, undeclared work, leases, handoffs, dependency escape, stale anchors, unfinished causal work, uncertain decisions, full descendant accounting, and succession reset rejection. Repository integration verifies reviewed installation, preserved legacy state, restart, source drift, and unchanged warm-history behavior. Installed production acceptance remains a separate requirement.
