# ADR-0487: Plan and apply approval-free upgrades in one exclusive window

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md), [ADR-0484](0484-keep-upgrades-exclusive-with-background-knowledge-work.md)
Amended by: [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)

> **Amended (2026-11-02).** Under ADR-0561, the one-window apply described here is what `lervo upgrade --apply` does for every plan; `--safe` stays accepted as the same apply. The exact `--approval` path, `--approve-role-binding`, `upgrade_owner_approval_required`, `upgrade_plan_changed`, and the presented-plan record are removed. A removed option fails with one line naming the undo path. The receipt's `approvedPlanId` becomes `planId`.

## Context

After ADR-0484 deployed at `a2bd3c7b`, `lervo upgrade --apply --approval <plan-id>` repeatedly failed on the WSL `lervo` repository with "--approval must equal the exact current repository upgrade plan ID." After printing a plan, the command waited up to 15 minutes for the host's full-cycle admission. Resident knowledge commits and replica pulls changed repository bytes during the wait, giving the plan recreated under admission a different ID. On a busy repository, plan, approve, and apply never converged. The failure identified neither the new plan nor the changes.

## Decision

### `lervo upgrade --apply --safe`

`--safe` replaces `--approval` for upgrades needing no owner decision. It cannot be combined with `--approval` or `--approve-role-binding`.

1. Acquire the background resident's full-cycle admission, as an exact apply does under ADR-0484.
2. Plan inside that window.
3. If any stage is `pending_authority`, refuse with `upgrade_owner_approval_required` and apply nothing. The message and JSON `stages` field list every such stage and its reason, such as `terminal_integration (provider_hook_approval_required)` or a `workforce` stage with a repository role binding to review.
4. Otherwise, apply the computed plan using the exact apply's stage order, dependencies, and receipt. The receipt's `approvedPlanId` is that plan's ID.

This path needs no separate review. Applied stages are limited to `safe_apply`, which policy restricts to generated or Lervo-owned bytes (`generatedOnlyAutomaticApply`). As in an exact apply, `blocked` and `deferred` stages are reported and skipped; a blocked plan with no applicable stage is refused.

Planning after admission incorporates changes accumulated while waiting. Admission excludes resident full cycles on this host through the last stage, but does not freeze repository inputs. Publication, continuity reconciliation, materialization by another host process, replica changes, and user edits remain outside the exclusion and may change inputs after planning.

Each inner stage retains ADR-0214's exact current plan and durable apply contract, including revalidation and stale-input refusal. ADR-0484's foreground marker settlement still governs knowledge operations: wait for a live owner and retry a marker-refused operation only if it checks the marker before any effect. Repository knowledge scans retry concurrent revision or file changes at most three times, then fail with `source_bytes_changed` if changes persist.

These mechanisms neither guarantee that a computed plan remains current nor authorize blind replay of effects. A later stage failure retains its existing failure and recovery meaning; it does not mean earlier stages applied nothing.

The exact approval path remains unchanged and required whenever an owner must review user-owned or provider-owned bytes, including repository role bindings and provider hooks.

### Changed-plan refusal

Plain `lervo upgrade` records its presented plan in `.lervo/state/upgrade/presented-plan.json`, an untracked file overwritten on each presentation. If `--approval` differs from the plan recreated under admission, fail with `upgrade_plan_changed` and name the current plan ID. If the approved plan was presented on this checkout, also name each changed input:

- CLI build;
- project identity;
- upgrade policy;
- each stage whose disposition, inner plan ID, or reason changed, for example `knowledge (plan kmig_… -> kmig_…)`.

The JSON error includes `approvedPlanId`, `currentPlanId`, and `changes`. When no stage needs an owner, the message suggests `lervo upgrade --apply --safe`.

## State, privacy, and failure meaning

The presented-plan record contains the same local plan as `lervo upgrade --json`. Its only absolute path is the repository root; it contains no credentials or provider content. It is a rebuildable projection: a missing or unreadable record only makes the refusal less specific.

- `upgrade_owner_approval_required`: `--safe` found at least one stage needing an owner and applied nothing.
- `upgrade_plan_changed`: the exact approval no longer matched and nothing was applied.

## Verification

Focused tests must show:

- `--safe` succeeds when repository bytes change while it waits for admission, and its receipt binds the newly computed plan.
- An exact apply under the same conditions fails with `upgrade_plan_changed`, naming the current plan ID and changed `knowledge` stage.
- `--safe` refuses a plan with a role binding needing review, names every stage needing an owner, and changes nothing.
- `--safe` cannot be combined with `--approval`.

Installed verification must run `lervo upgrade --apply --safe` on the busy WSL `lervo` repository and observe a completed receipt.

## References

- [Repository upgrade orchestration](../../../roadmap/onboarding/repository-upgrade.md)
- [Host-wide full-cycle admission](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/resident-cycle/admission.md)
