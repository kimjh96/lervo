# ADR-0582: Reuse one repository scan across an upgrade command

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0578](0578-plan-the-upgrade-knowledge-stage-from-one-scan.md) (inspections and lint stop scanning on their own), [ADR-0575](0575-follow-published-releases-on-every-host.md) (the follower does not run a `--safe` apply that the plan shows would refuse)
Amended by: [ADR-0589](0589-shorten-the-follower-path-from-publication-to-the-last-repository.md) (the follower also skips the `--safe` fallback that the changed-plan refusal shows would refuse; an apply that changed nothing skips lint while knowledge is current), [ADR-0561](../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (the follower applies with `--apply` alone; no stage waits for an owner approval, so neither `--safe` nor its refusal remains)
Related: [ADR-0579](0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md) (the `stageTimings` this decision reads), [ADR-0544](../knowledge/repository/source-intake/0544-observe-every-source-and-budget-only-retained-content.md) (observed-only sources)

## Context

The v0.25.3 hands-off follower pass was the first to record `stageTimings`. Each repository's knowledge inspection still dominated the time:

- WSL `lervo`: 601 seconds in all, 423 of them in apply. Each of the two rounds spent about 60 seconds in `knowledge_lint`, 42 to 53 in `plan_command`, 42 to 45 in `plan`, 35 in `knowledge`, and 38 to 43 in `final_plan`.
- Mac `axli`: 1,107 seconds, with `plan` 184, `knowledge_lint` 146, `plan_command` 125, `knowledge` 115, and `final_plan` 107. The owner's own jobs loaded the Mac at the time.
- Mac `argo`: 610 seconds and a blocked result. Its plan was blocked on content (`document_directory_file_capacity_exceeded`), and `repository_node` was its only applicable stage. `--safe` applied that stage, then paid 96 seconds in `knowledge` and 187 in `final_plan` to find the same block again.

ADR-0578 made one inspection read one scan, but every inspection still read its own. One `lervo upgrade --apply` inspects knowledge in the plan it recreates inside the exclusion, before each knowledge step, and in the final plan. Knowledge lint scans 4 more times, including a rewriter ownership inspection that scanned without the evidence sources the rest of lint uses. On a copy of WSL `lervo` with an isolated home and host, an apply that changed nothing took 185 seconds and ran 7 scans, 91 seconds of them scanning. The plan-only command took 43 seconds with 1 scan of 16 seconds.

The review of ADR-0578 also set a limit. Reusing the plan's inspection lost a source edit made between the plan and the knowledge step, so each step must see the bytes as they are when it runs.

## Decision

### One command reuses a scan while its fingerprint holds

`withRepositoryKnowledgeScanReuse(run)` opens a scope for one command. Inside it, `scanRepositoryKnowledge` keys each scan by its exact inputs: repository root, project, policy, generated paths, source-unit failure mode, and every supplemental evidence source. A later scan with the same key returns the earlier scan, but only after its fingerprint holds. Otherwise it scans afresh and replaces the entry. Scans with injected Git observers or a source-unit cache are never kept.

`lervo upgrade` opens the scope around the whole command, plan-only or apply. The plan inside the window, every knowledge step and its re-plan, the baseline and final lints of a migration apply, knowledge lint, and the final plan all go through it.

Lint's rewriter ownership inspection now scans with the caller's evidence sources. Normalization records read their outputs from disk and never from the scan, so the records are the same and the inspection shares lint's scan.

### The fingerprint observes everything the scan read

The scan records its fingerprint as it walks:

- the Git `HEAD` it observed and the exact set of paths `git status --ignored=matching` reported as ignored;
- the document move lineages and the layout taxonomy it resolved paths and priorities with;
- each directory it listed, as its entry names and types;
- each nested Git working tree it skipped;
- each file it inspected, as device, inode, mode, size, and modification and change times in nanoseconds.
- each project skill package hash it compared with the package manifest. The package hash covers every file in the package, including Git-ignored, policy-excluded, and `.DS_Store` files that the walk never observes, so a reuse hashes the package again. A changed package then makes the fresh scan fail closed with `knowledge_unit_extraction_failed`, as it would without reuse.

A reuse observes all of these again. A file whose last change fell within 2 seconds of its observation could change again within one filesystem timestamp tick, as Git's racy entries can. Such a file is compared by its bytes against the scan's content hash. When the scan kept no hash for it, the scan is not reused. The window is measured against the process clock, so a filesystem whose timestamps lag that clock by more than 2 seconds, such as some network mounts, weakens it; local disks stamp files from the same clock. Any difference, or any observation that fails, means a fresh scan. A check lists the walked directories, stats the walked files, and runs `git rev-parse` and `git status`; on the `lervo` copy `git status --ignored=matching` alone took 0.2 seconds, and a scan 13 to 16 seconds. The check's own time is recorded in the `scan_reuse_check` process-cost scope.

Excluded and Git-ignored subtrees are not walked, so they are not in the fingerprint; the ignored set and the policy that decide them are. Generated outputs are part of the key, so a materialization that changes them scans again.

### Exactness does not change

Reuse never decides a write on its own. Every apply still plans again inside the scope, and a scan it reuses is one whose fingerprint was just observed to hold. A plan ID that differs is still refused as `knowledge_plan_stale`. A migration apply's baseline lint reuses the plan's scan, and its lint after the writes scans again, because the writes changed the fingerprint or the generated paths.

An edit by the owner, an agent, or a hook during the upgrade is still read by the next inspection in the same run. The upgrade does not reuse inspections, only scans, and every scan reuse first checks for exactly such an edit.

### The follower skips a `--safe` apply that would refuse

`lervo upgrade --apply --safe` refuses with `upgrade_owner_approval_required` before any write when a stage waits for owner approval. When the plan-only command already shows such a stage and the plan is not `ready`, the follower records that result from the plan and does not run the apply. The pass entry names the stages in `pendingStages`. A plan that changes before the next pass is applied then, as before.

A blocked plan with an applicable stage, such as argo's `repository_node`, is still applied. The Node stage must run, and the knowledge stage must still be inspected for an edit made during the run. Scan reuse makes those inspections, lint, and the final plan cheap.

## States, privacy, and failure meaning

No event, file, column, or receipt field is added. The follower's pass entry can carry the existing code `upgrade_owner_approval_required` without an apply.

- The scope holds at most 2 scans and their fingerprints, in the memory of one command. Nothing persists them. The scan content is the same repository content scans already held.
- A scan whose fingerprint does not hold releases the other kept scans of the same repository before the new scan is read, so a command never holds two scans of one changed tree.
- A failed fresh scan is not kept, and the error surfaces as before.

## Consequences

Baseline, measured on a copy of WSL `lervo` with an isolated home and host on origin/main (v0.25.3), one plan and two applies that changed nothing:

| Command                               | Wall time    | Scans |   Scanning |
| ------------------------------------- | ------------ | ----: | ---------: |
| `lervo upgrade --json`                | 43 s         |     1 |       16 s |
| `lervo upgrade --apply --safe --json` | 185 s, 185 s |     7 | 91 s, 93 s |

The applies' parts were `plan` 37 to 41 seconds, `knowledge` 35 to 40, `knowledge_lint` 65 to 69, and `final_plan` 39 to 42; every other part took about a second or less.

The after numbers are not measured yet: the test host became unavailable before the run. They will come from the `stageTimings` of the first follower pass after the release that carries this change, on WSL and the Mac. Expected, not measured: an unchanged apply scans once or twice instead of 7 times, and each reused scan costs a fingerprint check instead of 13 to 16 seconds.

The rest of an inspection is not scanning. A CPU profile of one inspection on the copy showed collecting the 75,592 evidence pages from the event store (about 4.4 seconds, once per inspection and lint), listing events for the terminal integration stage (about 2 seconds), and building the structural plan. These keep their cost per inspection. Follow-up: reuse the evidence collection within a command, keyed on an exact event-store high-water mark, and prove with a test that an event appended during the upgrade is still read.

WSL `axli` spent 76 seconds in `node_readiness` on both v0.25.1 and v0.25.3, while other repositories took 2 to 27 seconds. The journal shows only that the process started within a second of the stop; no component timing is recorded. Follow-up: record when each readiness component was first accepted in the onboarding receipt, so the next pass names the slow one.

## Verification

Each test below fails on origin/main unless noted.

- `scan-reuse.test.ts`: two scans in one scope read the repository once and return the same scan; outside a scope, twice. Different evidence sources are different keys. An edit that keeps the size and modification time, an edit inside the racy window, an added file, a changed `.git/info/exclude`, and a new commit each scan again and read the new state. A change to a Git-ignored file inside a project skill package refuses the reuse, and the fresh scan fails closed.
- `upgrade-knowledge-scan-reuse.test.ts`: a whole `lervo upgrade --apply` whose tree does not change scans at most twice: once, and again only if the event writer's own events change the evidence sources. On origin/main the inspections and lint scan separately. A source edit made after the plan inside the window, keeping its size and modification time, is still materialized in the same run; this passes on origin/main too and guards the reuse.
- `host-repository-pass.test.ts`: a plan with a stage waiting for owner approval ends the repository as `blocked` with `upgrade_owner_approval_required` after the plan command alone, and the runner reads those stages from the plan.
