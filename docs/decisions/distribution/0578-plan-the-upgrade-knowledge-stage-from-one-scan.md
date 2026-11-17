# ADR-0578: Plan the upgrade knowledge stage from one scan

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0214](../operations/services/0214-bounded-repository-upgrade-orchestration.md) (how the knowledge stage is inspected), [ADR-0574](0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (closes its held hand-off of knowledge materialization)
Related: [ADR-0487](../operations/services/0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md) (planning inside the window), [ADR-0575](0575-follow-published-releases-on-every-host.md) (host follower)

## Context

On the v0.25.1 rollout, the WSL host follower took 28.7 minutes. The `lervo` repository alone spent 484 seconds in apply. ADR-0574 held one remedy back: run the knowledge materialization that an upgrade schedules as the next normal background cycle. Measurement shows that materialization was not the cost.

- **No materialization ran.** The plan that the WSL upgrade presented for `lervo` listed `node` as its only applicable stage. Its knowledge stage was `current` with reason `background_owned`. The event store recorded no `knowledge.materialization.applied` event during that upgrade.
- **Inspection repeated the same scan.** The knowledge stage is inspected by running `lervo migrate knowledge --integration-head --json` in process. That run plans the continuation, instruction bootstrap, layout, structural, instruction bridge, and normalization stages. Each plan scanned the repository again. The upgrade then planned the layout once more to list deferred documents. A plan-only timing on the live repository, with host writes left out, measured each of these 7 scans at 11 to 17 seconds. With local source collection, one inspection took about 112 seconds.
- **Apply inspected three times.** `lervo upgrade --apply` inspects knowledge in the plan it recreates inside the exclusion, again at the start of the knowledge step, and again in the final plan. Knowledge lint adds 4 more scans, about 52 seconds. Three inspections, lint, and the Node stage account for the 484 seconds.
- **The compiler version does not force work.** The structural compiler is the fixed identifier `lervo.structural@2`. The stage is `current` when every desired output equals the bytes on disk, so a CLI release whose compiler output is unchanged schedules no materialization. The earlier v0.24.x materializations wrote real output changes, such as 25 created and 196 updated files on 2026-11-17.

The cost is repeated work over an unchanged source snapshot, not materialization.

## Decision

### The migration plans share one scan until the first write

`runKnowledgeMigration` scans the repository once, with the same supplemental sources as before, right after the materialization settlement. It passes that scan as `preparedScan` to every stage plan before the first write: continuation, instruction bootstrap, layout routing, structural migration, instruction bridge, and normalization. `createContinuationWorkstreamMigrationPlan` gains the optional `preparedScan` that the other plans already accept.

Each of these plans already read the same configured scan, so the plans and their IDs do not change. On a copy of the WSL `lervo` repository, the plan output was byte-identical before and after this change.

The shared scan never decides a write. Every apply function plans again from a fresh scan and refuses a different plan ID with `knowledge_plan_stale`: continuation, instruction bootstrap, layout, and structural migration. The instruction bridge applies through its own command, which also scans fresh. Layout classification with `--provider` writes only host-private evidence, which the default scan policy excludes under `.lervo/**`, so its re-plan reuses the scan too.

Knowledge lint keeps its own scans. Its before-and-after comparison around an apply must read both states the same way.

### The upgrade does not plan the layout twice

`runKnowledgeMigration` takes an optional `observeLayout` callback. The upgrade's knowledge inspection uses it to read deferred documents from the layout the run already planned. It plans the layout itself only when the run never reached the layout stage, as before.

### Apply reuses the inspection it just made

The plan recreated inside the exclusion already inspected knowledge. The knowledge step reuses that inspection when two conditions hold:

- No earlier stage applied anything in this run.
- The inspection had nothing to apply: its disposition is `current`, `pending_authority`, or `blocked`.

A `safe_apply` or `deferred` knowledge stage is inspected again right before its apply, as before. Every later knowledge step, and every retry after a materialization marker refusal, inspects again. The final plan still inspects knowledge after all stages.

### Materialization stays in the upgrade window

This closes the hand-off that ADR-0574 held. Knowledge materialization that an upgrade schedules still runs inside the upgrade, on every host, with the new compiler. Each concern ADR-0574 listed stays resolved, because nothing moves out of the window. The cost that justified the hand-off is gone.

## States, privacy, and failure meaning

No event, file, column, or receipt field is added.

- `preparedScan` and the observed layout live only in the memory of one command. They hold repository source content as before, and nothing persists them.
- A scan failure, such as an open materialization transaction or a changed source during the scan, now surfaces from the shared scan with the same error code that the first stage plan raised before.
- A source change after the shared scan is caught when an apply plans again, as `knowledge_plan_stale`, or reported by the final plan as a stage that is no longer current.

## Consequences

Measured on a copy of the WSL `lervo` repository with an isolated home, plan-only, two runs each:

| Command                                             | v0.25.1      | This change |
| --------------------------------------------------- | ------------ | ----------- |
| `lervo migrate knowledge --integration-head --json` | 100 to 111 s | 34 to 39 s  |
| `lervo upgrade --json`                              | 125 s        | 35 s        |

Estimated, not measured: a `lervo` upgrade apply whose knowledge is current drops from 484 to about 190 seconds on WSL. Two inspections of about 35 seconds replace three of about 118, and lint (about 55 seconds) and the Node stage are unchanged. The follower's plan before apply drops from about 123 to 35 seconds. Smaller repositories save the repeated scans and one of their four inspections.

Knowledge lint is now the largest knowledge cost in an upgrade, with 4 scans. Sharing them needs its own proof that the four scan inputs agree, because lint compares states around an apply.

## Verification

- `upgrade-knowledge-scan-reuse.test.ts`: a plan-only `lervo migrate knowledge` that reaches the normalization stage scans once, where the previous release scanned 6 times. The upgrade's knowledge inspection also scans once. An approved upgrade apply whose knowledge stage is not `safe_apply` inspects knowledge twice, where the previous release inspected it three times.
- The existing upgrade, layout migration, layout decision, document routing, terminal integration, workstream, and CLI suites pass unchanged, including the apply that sees the plan change while it waits.

Installed verification: after the release that carries this change, record the `lervo` apply time on WSL and the Mac in the [release-to-fleet roadmap](../../roadmap/operations/release-to-fleet.md).
