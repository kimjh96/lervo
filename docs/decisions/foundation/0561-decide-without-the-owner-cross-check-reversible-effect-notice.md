# ADR-0561: Decide without the owner: cross-check, reversible effect, notice

Status: `accepted`
Decision date: 2026-11-02
Amends: [ADR-0452 open collaboration](0452-open-collaboration-by-default-with-authority-at-consequential-effects.md) (authority at consequential effects), [ADR-0463 document freshness](../knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) (owner authority), [ADR-0557 Tier 0 cross-check](../knowledge/documents/freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md), [ADR-0559 layout decision](../knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md)
Amended by: [ADR-0591](../distribution/0591-accept-the-previous-followers-upgrade-arguments.md) (`lervo upgrade --apply` accepts and drops `--approval <plan-id>` from the previous release's follower; `--json` failures print JSON)
Related: [ADR-0453 principal mandate](../coordination/conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0560 core hardening](0560-remove-unused-subsystems-to-harden-the-core.md)

## Context

The owner ruled on 2026-11-02: Lervo decides and proceeds on its own, and the owner is never a review or approval step.

An inventory on 2026-11-02 found 41 places where Lervo waits for the owner:

- About 9 already have an independent check next to them: the Tier 0 cross-check for freshness, the background lifecycle reviewer for layout, normalization, bridge, and bootstrap, and the canonical reviewer. The owner is asked anyway, through a condition that hands the decision over.
- About 26 protect bytes that Git or a backup can restore.
- About 10 protect effects that cannot be restored or that leave the host: credentials, external messages, deployment, spend, public publication, cross-host writes, and overwrites without a backup.

The instruction intake gate is the worst case. When an owner rule is not low-risk, add-only, conflict-free, high-confidence, and explicitly scoped, the rule is dropped without being stored. Both owner rules stated on 2026-11-02 were lost this way.

## Decision

### The rule

No Lervo path waits for an owner approval, review, decision, or approval hash. Every consequential effect instead passes three steps:

1. **Independent cross-check.** A session that did not produce the change judges it against the cited evidence. This is ADR-0557's no-capability call, or the existing lifecycle or canonical reviewer when one covers the effect. The reviewer must not share a session or conversation with the writer.
2. **Reversible effect.** The effect lands so that one command undoes it: a Git commit for repository bytes, a recorded preimage, or a backup taken before the write.
3. **Notice after the fact.** The owner receives one short notice saying what changed, why, and how to undo it. It reaches the terminal turn report and, once the escalation path exists, Discord. A notice is information, not a task. Nothing waits for it.

Disagreement is never escalated to the owner. A disagreeing cross-check rejects the change, and Lervo regenerates once with the disagreement as evidence. If the second attempt also disagrees, the change is held with backoff and recorded as Lervo's own unresolved debt, visible in health with its age. It is never shown as owner work.

### Effects that cannot be undone or that leave the host

These effects still never wait for the owner. They need a stronger check instead:

- two independent cross-checks that agree, from different sessions and, when admitted, different providers;
- a backup or dry run before the effect, where one is possible;
- the existing budgets and loop guards as hard limits.

| Effect                                                    | Stronger check                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overwrite or deletion without a backup                    | Take the backup first, so it becomes reversible; otherwise two agreeing checks.                                                                  |
| Cross-host repository writes, replica preference          | Save the losing side to a backup branch, then apply.                                                                                             |
| Deployment and service changes                            | Back up the service definition, apply as a transaction, verify readiness, and roll back on failure.                                              |
| Spend above budget, external messages, public publication | Two agreeing checks within the configured budget; above the budget, hold as Lervo debt.                                                          |
| Credentials                                               | Lervo cannot create or repair the owner's credentials. It reports what is missing as a notice and continues every stage that does not need them. |

### Owner rules are always kept

An owner-stated rule is stored. The intake gate stops dropping candidates. A rule that conflicts with an existing rule replaces the older one in the same scope, and the replacement is reported in a notice. A rule that is broad, removes behavior, or changes authority is stored with that classification and applied like any other rule. Applying it is the owner's own instruction, so it needs no cross-check of authority, only a check that the stored text matches what the owner said.

### Limits: user-owned bytes and the owner's hold

AGENTS.md invariant 5 is unchanged: Lervo never rewrites user-owned content on its own. Freshness applies only Lervo-managed bytes; a user-owned hunk or archive stays `suggested`, with no cross-check spent. A reviewed lifecycle plan may move whole documents byte for byte and write Lervo's outputs anywhere, because Git keeps the bytes and the path under one revert. Creating a user file where none existed overwrites nothing. Rewriting or deleting one is allowed only inside the roots of the delegation the owner installed. Outside them the plan is parked as `user_owned_content` debt, and an upgrade never applies it; an owner command such as `lervo migrate knowledge --apply` still can.

Every effect lands as its own commit, so it applies only when that commit is possible and no user path it touches holds uncommitted work; outside Git a reviewed effect is `commit_unavailable` debt. An apply that throws, or a commit that does not land, restores every changed path.

`lervo repository hold --root <path> [--reason <text>]` is the owner's way to defer one repository. The hold sits in host state beside the repository registry. While it lasts, the follower runs no upgrade there; the resident runs no stage, publication, or continuity; every effect reads it again right before writing; and the replica coordinator, which reads each side's hold from that side's host, transfers nothing. Plans and notices continue. `lervo repository release` ends it, and an unreadable hold file holds every repository. Undoing a provider hook merge with `lervo state restore` holds that merge the same way, and no automatic record evicts an owner hold.

Bounded follow-ups: `repository-replica restore` does not guard work done after the resolution; a `concurrent_commit` leaves the effect's reverse diff uncommitted; effects on Git-ignored paths have no undo; `lervo init` applies without the user-owned check; Node supervision and principal-proxy writes do not read the hold.

### Replacement by area

- **Freshness.** Tier 0 agreement sets authority to `none` for every Lervo-managed hunk class. `safety_or_policy` hunks and archives need two agreeing checks. `needs_owner_input` first tries ADR-0494 evidence recovery and regeneration; otherwise the document is marked stale with its reason in health.
- **Layout and migration.** The lifecycle reviewer applies classified byte-preserving moves whatever the delegation's roots. The out-of-scope deferral and the ADR-0559 accept and decline commands are removed. Document structure operations use Tier 0, and delete becomes archive or commit-then-delete.
- **Canonicalization and instructions.** Candidates are promoted after the independent canonical review. The instruction bridge and bootstrap always take the background reviewed path.
- **Delegation and scope.** Delegations renew automatically within the last installed policy bounds. Scope additions are accepted when the classifier and Tier 0 agree. The 32-root limit no longer blocks a complete move plan, because the reviewed plan carries its own exact path set.
- **Upgrade and terminal integration.** `lervo upgrade` applies every cross-checked stage without `--approval`. Provider hook files and Node service units are backed up, applied, verified, and rolled back on failure.
- **Workstream and Hub.** Reconciliation keeps the newest valid head and preserves the other head. A replica conflict saves the losing side to a backup branch on its own host and records the notice before either side changes; `lervo-node repository-replica restore` puts it back and holds the repository.
- **Supervision.** After the escalation bound, the principal proxy (ADR-0453) decides within its mandate instead of waiting for the owner.

The per-item approval commands (`--approve-item`, `--approval`, `--accept-layout`, `--decline-layout`, `scope-response`, `canonicalization review/promote`, `instruction review`, `freshness apply --approval`) are removed. Undo commands stay.

## State, events, privacy, and failure meaning

- The notice uses the existing post-development notice path (ADR-0549), with fields `{effect, targets, reason, crossCheck: {reviewers, verdict}, undo}`. It never contains document bodies or secrets.
- `requiresUserAction` and the `owner` actor are removed from attention attribution for every effect above. The health owner-authority line is replaced by a "Lervo debt" line, which lists held changes with their age and reason.
- A held change records the reason code `cross_check_disagreement_repeated`, `stronger_check_disagreement`, or `budget_exceeded`.

## Consequences

- The owner sees notices and can undo. They are never asked.
- Mistakes are possible and reversible. The cross-check, the regeneration limit, and the hold-as-debt rule bound how many mistakes can happen and how long they last.
- AGENTS.md invariant 10 changes from "check authority at consequential effects" to "cross-check, make reversible, and notify at consequential effects".

## Verification

- Every gate in the 2026-11-02 inventory is removed or replaced, and a test exercises the replacement.
- The two owner rules dropped on 2026-11-02 are stored when they are submitted again.
- On argo, the layout plan, which rewrites references in user documents outside the delegated roots, parks whole as `user_owned_content` debt, its 20 byte-identical moves included, because a plan applies all or nothing. The debt names `lervo migrate knowledge --apply <plan-id>`.
- `rg` finds no `--approve-item`, `--approval`, or `requiresUserAction: true` path for the effects above.

### Results (2026-11-02)

Slices A1 to A7 implement the decision on the `remove-owner-approval-gates` branch:

- **Gates.** A1 stores every owner rule, A2 freshness, A3 layout, migration, and structure, A4 canonicalization, delegation, and continuity, A5 upgrade, provider hooks, capabilities, and state, A6 workstream heads, replica conflicts, and supervision escalation, and A7 onboarding, convergence ownership, publication, recorded workstream approvals, and assignment approvals. Each replacement has a runtime or CLI test, listed per slice in the [delivery sequence](../../roadmap/open-collaboration-platform/delivery-sequence.md).
- **Owner rules.** An A1 CLI test stores and applies the two owner rules the former intake gate dropped on 2026-11-02.
- **Health and notices.** The health owner-authority line is replaced by one Lervo debt line with count, oldest age, and top reason, including the Node's supervision and workstream debt. Every freshness and effect notice carries `{effect, targets, reason, crossCheck: {reviewers, verdict}, undo}`; effects without a commit report through the bounded effect notice journal.
- **Search.** Over `apps`, `packages`, `scripts`, and `.agents` without tests, `requiresUserAction: true` no longer appears. The remaining `--approve-item` and `--approval` hits are refusals of removed options, release scripts, and comments. `owner_decision` and `pending_user_approval` remain only so stored records parse.
- **Not yet verified.** The argo debt after release, and the Hub remote-command `require_approval` for Hub-issued writes, which still needs the Node-side stronger check named in the delivery sequence.

### Re-land on the ADR-0560 release (2026-11-18)

The slices were applied again on top of the ADR-0560 removal, after 389 later commits on `main`. Each slice's intent was applied to the current code; nothing was rebased mechanically. The paths `main` added after 2026-11-02 were decided by the rule above:

- **Follower owner-approval handling: in scope.** [ADR-0582](../distribution/0582-reuse-one-repository-scan-across-an-upgrade-command.md) and [ADR-0589](../distribution/0589-shorten-the-follower-path-from-publication-to-the-last-repository.md) gave the host release follower `ownerApprovalStages`, `upgrade_owner_approval_required`, an exact `--approval` apply, and a `--safe` fallback. They are removed. Each round runs `lervo upgrade --json`, then `lervo upgrade --apply --json`. A plan or receipt in `lervo_debt` ends the repository as `blocked` with `upgrade_lervo_debt` and names the held stages in `pendingStages`. Such a repository still runs last in a pass, but it keeps the hourly recheck instead of waiting for another CLI, because Lervo clears its own debt once a provider is admitted or the held plan changes. The runner reads `lervoDebtStages` from a plan. `upgrade_plan_changed` no longer exists. The deploy skill's `upgrade-all.sh` keeps a receipt per round.
- **ADR-0583 layout capacity hold (`destination_capacity`): kept as Lervo's hold.** A move that would overfill a directory breaks the configured layout policy, which no cross-check can authorize, so the planner still holds it. The hold is not a decision the owner is asked for: the deferral line, the specification, and `lervo upgrade` say that Lervo holds the move and that nothing waits for the owner. A capacity override or a route in front matter releases it, as for any configured route. The `delegation_scope` deferral that ADR-0583 also listed is removed with A3.
- **Upgrade exclusion checks (ADR-0577), stage timings (ADR-0579), and scan reuse (ADR-0582): kept.** Only the approval checks were removed. The knowledge loop of an upgrade apply confirms the exclusion before each write and times each step.
- **The ADR-0578 shared pre-write scan in `lervo migrate knowledge`: kept.** The continuation and bootstrap stages read it, and the layout stage releases it before an apply.
- **CAS retention: out of scope.** [ADR-0584](../operations/storage/0584-let-cas-retention-finish-a-pass-on-a-live-host.md) to [ADR-0586](../operations/storage/0586-release-superseded-stage-records.md) and `lervo state cas-retention --plan` are unaffected. Retention takes no owner approval, and the plan command never deletes.
- **Admission and preemption: out of scope.** [ADR-0574](../distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md), [ADR-0577](../distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md), and [ADR-0587](../distribution/0587-abandon-a-background-provider-call-for-a-waiting-upgrade.md) are unaffected. These order Lervo's own work and ask the owner for nothing.
- **A host CLI install held as `host_blocked`, such as an unmanaged `lervo` link: out of scope.** The link is user-owned host state outside the repository, and the install refuses to overwrite it. This is the credential and host boundary of the exception table, not an approval wait.
- **Hub remote-command `require_approval`: unchanged.** It stays until a Node-side two-check path exists.

`main` had folded the canonical rejection cases into the workset halving test, so the A4 case that an undecided source regenerates once before it parks runs alone.
