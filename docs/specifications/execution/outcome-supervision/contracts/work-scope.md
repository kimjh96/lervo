# Reviewed goal scope

Operating mandate version 3 can bind a new bounded goal within a long-lived workstream. Versions 1 and 2 retain their workstream-wide task and resource semantics. Version 3 retains the designated execution host and adds an exact reviewed `workScope`; it does not reconcile device histories.

## Authority and historical work

`workScope` requires `schemaVersion: 1`, `workstreamId`, `snapshotEventId`, `snapshotEventHash`, and `excludedAssignments`. Each exclusion pins an `assignmentId` and the complete current assignment `contentHash`. The list must be unique and contain no more than 256 entries. The anchor must be the exact canonical snapshot event for the same project and workstream.

Each excluded assignment must have completed or failed before the anchor, retain no lease or handoff, and have no supervised responsibility binding or topology provenance. Every prior assignment must be explicitly covered, and dependencies must not cross the historical boundary. Observation and installation reject changed, missing, active, supervised, or undeclared prior assignments. All prior causal work, including every recorded descendant, must be terminal before the anchor. Pending or uncertain supervision decisions at the anchor reject the scope.

`lervo agent mandate scope` applies these same rules to every canonical snapshot from newest to oldest and returns the newest scope the exact validator admits. It automatically pins eligible terminal assignments. An unresolved assignment, causal run, supervision decision, or dependency boundary makes a later snapshot ineligible; selection can therefore return a snapshot before that work was created. If no safe snapshot exists, it fails instead of guessing, settling work, or widening authority. The generated scope is still review input and grants nothing until it is included in an approved mandate installation.

This review identifies prior tasks outside the new goal. It does not:

- turn failure into acceptance;
- prove unobserved historical provider work;
- repair unavailable telemetry; or
- remove any assignment, event, artifact, or resource observation.

Legacy terminal records without managed execution evidence remain unmanaged. Historical resource reports retain their original scope and may remain incomplete or invalid.

## New goal accounting and completion

The new goal contains assignments created after the anchor. Its aggregate budget includes every causal work tree rooted after the anchor in the workstream, including owner reasoning, retries, workers, and evaluation descendants. Selecting a root never truncates its descendants. Existing provider, accounting-descriptor, scope, missing-usage, reservation, and admission checks continue to apply. The bounded goal total is not a lifetime workstream total.

Task observation retains the complete assignment set alongside the scoped task set. Before commit, source digests, topology checks, assignment transitions, and goal completion revalidate preserved predecessors. Goal completion applies to the current bounded workstream objective and requires independent acceptance of every current task. Publishing the accepted result requires separate authority.

A successor mandate cannot change or remove an installed scope, including after revocation. A workstream-wide predecessor must be revoked before version 3 is adopted. A new scope requires a separate reviewed installation. The autonomous owner cannot reset its own budget by proposing a later anchor.

## Standing successor authority

Version 3 may carry an optional reviewed `successorAuthority` with `schemaVersion: 1` and `maximumSuccessors` between 1 and 1024 ([ADR-0405](../../../../decisions/execution/orchestration/governed-work/0405-standing-supervision-lineage.md)). It lets the installed owner derive one mandate per successor goal without a new review. A derived mandate is a separate installation with supervision and mandate IDs `<parent>.s<n>`, version 1, the parent's owner, host, bounds, ceilings, expiry and revocation prefix, a work scope anchored to the successor goal's start snapshot with no exclusions, and `maximumSuccessors` one lower or absent. The installation plan's `derivation` names the parent installation event, parent mandate hash and successor index inside the approval hash; installation recomputes the derivation and rejects a widened, re-anchored, re-indexed or revoked-parent child. The owner cannot reset a running goal's budget this way because derivation requires the current goal to be settled and always anchors a new workstream.

## Failure, privacy, and verification

The existing exact mandate installation artifact and event bind the scope. No new event type or credential field is introduced. Events retain existing mandate and review hashes. The artifact contains only bounded opaque assignment and event coordinates and hashes. It must not contain task prose, source bodies, provider output, or credentials.

Invalid or stale scope observations prevent admission and use the existing unavailable-supervision health and failure boundary.

Pure tests cover preserved failed predecessors, undeclared work, leases, handoffs, dependency escape, stale anchors, unfinished causal work, uncertain decisions, full descendant accounting, and succession reset rejection. Repository integration verifies reviewed installation, preserved legacy state, restart, source drift, and unchanged warm-history behavior. Installed production acceptance remains a separate requirement.
