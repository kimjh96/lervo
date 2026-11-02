# ADR-0561: Decide without the owner: cross-check, reversible effect, notice

Status: `accepted`
Decision date: 2026-11-02
Amends: [ADR-0452 open collaboration](0452-open-collaboration-by-default-with-authority-at-consequential-effects.md) (authority at consequential effects), [ADR-0463 document freshness](../knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) (owner authority), [ADR-0557 Tier 0 cross-check](../knowledge/documents/freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md), [ADR-0559 layout decision](../knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md)
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

### Replacement by area

- **Freshness.** Tier 0 agreement sets authority to `none` for every hunk class. `safety_or_policy` hunks and archives need two agreeing checks. `needs_owner_input` first tries ADR-0494 evidence recovery and regeneration; otherwise the document is marked stale with its reason in health.
- **Layout and migration.** The lifecycle reviewer applies classified moves whatever the delegation's roots. The out-of-scope deferral and the ADR-0559 accept and decline commands are removed. Document structure operations use Tier 0, and delete becomes archive or commit-then-delete.
- **Canonicalization and instructions.** Candidates are promoted after the independent canonical review. The instruction bridge and bootstrap always take the background reviewed path.
- **Delegation and scope.** Delegations renew automatically within the last installed policy bounds. Scope additions are accepted when the classifier and Tier 0 agree. The 32-root limit no longer blocks a complete move plan, because the reviewed plan carries its own exact path set.
- **Upgrade and terminal integration.** `lervo upgrade` applies every cross-checked stage without `--approval`. Provider hook files and Node service units are backed up, applied, verified, and rolled back on failure.
- **Workstream and Hub.** Reconciliation keeps the newest valid head and preserves the other head. Replica conflicts save the losing side to a backup branch first.
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
- On argo, the layout moves apply without any owner command, followed by a notice with the undo command.
- `rg` finds no `--approve-item`, `--approval`, or `requiresUserAction: true` path for the effects above.

### Results (2026-11-02)

Slices A1 to A7 implement the decision on the `remove-owner-approval-gates` branch:

- **Gates.** A1 stores every owner rule, A2 freshness, A3 layout, migration, and structure, A4 canonicalization, delegation, and continuity, A5 upgrade, provider hooks, capabilities, and state, A6 workstream heads, replica conflicts, and supervision escalation, and A7 onboarding, convergence ownership, publication, recorded workstream approvals, and assignment approvals. Each replacement has a runtime or CLI test, listed per slice in the [delivery sequence](../../roadmap/open-collaboration-platform/delivery-sequence.md).
- **Owner rules.** An A1 CLI test stores and applies the two owner rules the former intake gate dropped on 2026-11-02.
- **Health and notices.** The health owner-authority line is replaced by one Lervo debt line with count, oldest age, and top reason, including the Node's supervision and workstream debt. Every freshness and effect notice carries `{effect, targets, reason, crossCheck: {reviewers, verdict}, undo}`; effects without a commit report through the bounded effect notice journal.
- **Search.** Over `apps`, `packages`, `scripts`, and `.agents` without tests, `requiresUserAction: true` no longer appears. The remaining `--approve-item` and `--approval` hits are the one-line refusals of removed options, the CI release scripts that echo their own plan ID, and the comments that state the rule. `owner_decision` and `pending_user_approval` remain only so stored records parse.
- **Not yet verified.** The argo layout moves after release, and the Hub remote-command `require_approval` for Hub-issued writes, which still needs the Node-side stronger check named in the delivery sequence.
