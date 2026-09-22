# Reviewed goal scope

Operating mandate version 3 can bind a new bounded goal within a long-lived workstream. Versions 1 and 2 retain workstream-wide task and resource semantics. Version 3 retains the designated execution host and adds an exact reviewed `workScope`; it does not reconcile device histories. Successor authority version 2 may name a stable per-successor aggregate ceiling independently of a larger reviewed ceiling on the currently running goal.

## Authority and historical work

`workScope` requires `schemaVersion: 1`, `workstreamId`, `snapshotEventId`, `snapshotEventHash`, and `excludedAssignments`. Each exclusion pins an `assignmentId` and the complete current assignment `contentHash`. The list must be unique, with at most 256 entries. The anchor must be the exact canonical snapshot event for the same project and workstream.

Each excluded assignment must have completed or failed before the anchor, retain no lease or handoff, and have no supervised responsibility binding or topology provenance. Every prior assignment must be explicitly covered; dependencies must not cross the historical boundary. Observation and installation reject changed, missing, active, supervised, or undeclared prior assignments. All prior causal work, including every recorded descendant, must be terminal before the anchor. Pending or uncertain supervision decisions at the anchor reject the scope.

`lervo agent mandate scope` applies these rules to every canonical snapshot from newest to oldest and returns the newest scope the exact validator admits, automatically pinning eligible terminal assignments. An unresolved assignment, causal run, supervision decision, or dependency boundary makes a later snapshot ineligible; selection may return a snapshot before that work was created. If no safe snapshot exists, it fails instead of guessing, settling work, or widening authority. The generated scope remains review input and grants nothing until included in an approved mandate installation.

Planning and applying a later revision of an installed V3 mandate observe the workstream pinned by
that mandate's `workScope`, not whichever repository workstream is currently projected. Both
planning and apply-time revalidation use the same pinned coordinate. An unrelated current
workstream therefore cannot make an exact historical anchor appear missing, and it cannot redirect
the revised authority to itself.

This review identifies prior tasks outside the new goal. It does not:

- turn failure into acceptance;
- prove unobserved historical provider work;
- repair unavailable telemetry; or
- remove any assignment, event, artifact, or resource observation.

Legacy terminal records without managed execution evidence remain unmanaged. Historical resource reports retain their original scope and may remain incomplete or invalid.

An exact `pathRoots: ["*"]` is the reviewed repository-wide scope. It remains bounded to normalized repository-relative paths and never admits an absolute path, parent traversal, or filesystem escape. Narrow path roots retain their existing prefix semantics.

## New goal accounting and completion

The new goal contains assignments created after the anchor. Its aggregate budget includes every causal work tree rooted after the anchor in the workstream, including owner reasoning, retries, workers, and evaluation descendants. Selecting a root never truncates its descendants. Existing provider, accounting-descriptor, scope, missing-usage, reservation, and admission checks continue to apply. The bounded goal total is not a lifetime workstream total.

An exhausted V3 envelope blocks only the next supervised effect for that goal. It neither degrades
the Node process nor resets itself. A reviewed mandate revision may add capacity to the same goal;
all prior usage and reservations remain charged. A settled goal may instead advance through its
reviewed standing successor authority, whose distinct scope begins a new envelope.

A long-lived repository owner may instead carry reviewed `aggregateTokenPolicy.mode:
per_attempt_only`. Cumulative history and missing historical usage do not block admission in that
mode. Attempt tokens, retry count, concurrency, worker and assignment capacity, deadline, expiry,
provider, role, capability, and path limits continue to apply independently. The legacy numeric
aggregate field remains serialized for compatibility but has no admission meaning under this
explicit version-3 policy. Derived successors inherit the same policy.

Task observation retains the complete assignment set alongside the scoped task set. Before commit, source digests, topology checks, assignment transitions, and goal completion revalidate preserved predecessors. Goal completion applies to the current bounded workstream objective and requires independent acceptance of every current task. Publishing the accepted result requires separate authority.

A successor mandate cannot change or remove an installed scope, even after revocation. A workstream-wide predecessor must be revoked before adopting version 3. A new scope requires a separate reviewed installation. The autonomous owner cannot reset its own budget by proposing a later anchor.

## Standing successor authority

Version 3 may carry optional reviewed `successorAuthority` with `maximumSuccessors` between 1 and 1024 ([ADR-0405](../../../../decisions/execution/orchestration/governed-work/0405-standing-supervision-lineage.md)). Version 1 preserves the current aggregate ceiling. Version 2 also names `maximumAggregateTokens` for every derived goal, independently of a larger reviewed ceiling on the running goal. Both let the installed owner derive one mandate per successor goal without a new review.

Each derived mandate is a separate installation with:

- supervision and mandate IDs `<parent>.s<n>` and version 1;
- the parent's owner, host, non-aggregate bounds, reviewed successor aggregate ceiling, expiry, and revocation prefix;
- a work scope anchored to the successor goal's start snapshot with no exclusions; and
- `maximumSuccessors` one lower or absent.

The installation plan's `derivation` names the parent installation event, parent mandate hash, and successor index inside the approval hash. Installation recomputes the derivation and rejects a widened, re-anchored, re-indexed, or revoked-parent child. Derivation requires the current goal to be settled and always anchors a new workstream, so the owner cannot use it to reset a running goal's budget.

Successor authority version 1 preserves the parent's aggregate ceiling for compatibility. Version 2
instead carries `maximumAggregateTokens` for every derived goal. This permits a reviewed increase
for one unusually large running goal without silently granting that larger ceiling to every later
goal. The successor ceiling cannot be lower than the attempt ceiling and remains immutable across
automatic derivation.

## Failure, privacy, and verification

The existing exact mandate installation artifact and event bind the scope. No new event type or credential field is introduced. Events retain existing mandate and review hashes. The artifact contains only bounded opaque assignment and event coordinates and hashes; it must not contain task prose, source bodies, provider output, or credentials.

Invalid or stale scope observations prevent admission and use the existing unavailable-supervision health and failure boundary.

Pure tests cover preserved failed predecessors, undeclared work, leases, handoffs, dependency escape, stale anchors, unfinished causal work, uncertain decisions, full descendant accounting, and succession reset rejection. Repository integration verifies reviewed installation, preserved legacy state, restart, source drift, and unchanged warm-history behavior. Installed production acceptance remains a separate requirement.
