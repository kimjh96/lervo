# ADR-0487: Plan and apply approval-free upgrades in one exclusive window

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md), [ADR-0484](0484-keep-upgrades-exclusive-with-background-knowledge-work.md)

## Context

After ADR-0484 was deployed at `a2bd3c7b`, `lervo upgrade --apply --approval <plan-id>` on the WSL `lervo` repository failed again and again with "--approval must equal the exact current repository upgrade plan ID." The command printed a plan and then waited up to 15 minutes for the host's full-cycle admission. During that wait, resident knowledge commits and replica pulls changed repository bytes, so the plan recreated under the admission had a different ID. On a busy repository, the plan, approve, and apply sequence never converged. The failure also did not say what the new plan was or why it differed.

## Decision

### `lervo upgrade --apply --safe`

`--safe` replaces `--approval` for upgrades that need no owner decision. It cannot be combined with `--approval` or `--approve-role-binding`. It works as follows:

1. It acquires the background resident's full-cycle admission, as an exact apply does (ADR-0484).
2. It plans inside that window.
3. If any stage is `pending_authority`, it refuses with `upgrade_owner_approval_required` and applies nothing. The message and the JSON `stages` field list every such stage and its reason, for example `terminal_integration (provider_hook_approval_required)` or a `workforce` stage with a repository role binding to review.
4. Otherwise it applies the plan it just computed, with the same stage order, dependencies, and receipt as an exact apply. `approvedPlanId` in the receipt is that plan's ID.

Applying such a plan needs no separate review. Its applied stages are limited to `safe_apply` stages, which policy restricts to generated or Lervo-owned bytes (`generatedOnlyAutomaticApply`). `blocked` and `deferred` stages are reported and skipped exactly as in an exact apply, and a blocked plan with no applicable stage is still refused. Nothing can change the plan between planning and applying, because the window is exclusive with resident cycles.

The exact path is unchanged. It is still required whenever an owner must review user-owned or provider-owned bytes, such as repository role bindings or provider hooks.

### Changed-plan refusal

The plain `lervo upgrade` command records the plan it presents in `.lervo/state/upgrade/presented-plan.json`. This one file is overwritten each time and is not tracked. When `--approval` does not match the plan recreated under the admission, the command fails with `upgrade_plan_changed`. The message names the current plan ID. If the approved plan was presented on this checkout, the message also names each changed input:

- the CLI build;
- the project identity;
- the upgrade policy;
- each stage whose disposition, inner plan ID, or reason changed, for example `knowledge (plan kmig_… -> kmig_…)`.

The JSON error also carries `approvedPlanId`, `currentPlanId`, and `changes`. The message suggests `lervo upgrade --apply --safe` when no stage needs an owner.

## State, privacy, and failure meaning

The presented-plan record holds the same local plan that `lervo upgrade --json` prints. Its only absolute path is the repository root, and it contains no credentials or provider content. It is a rebuildable projection: if it is missing or unreadable, the refusal is only less specific.

- `upgrade_owner_approval_required` means that `--safe` found at least one stage that needs an owner and applied nothing.
- `upgrade_plan_changed` means that the exact approval no longer matched and nothing was applied.

## Verification

Focused tests must show:

- `--safe` succeeds when repository bytes change while it waits for the admission, and its receipt binds the newly computed plan.
- An exact apply in the same situation fails with `upgrade_plan_changed`, names the current plan ID, and names the changed `knowledge` stage.
- `--safe` refuses a plan with a role binding that needs review, names every stage that needs an owner, and changes nothing.
- `--safe` cannot be combined with `--approval`.

Installed verification must run `lervo upgrade --apply --safe` on the busy WSL `lervo` repository and observe a completed receipt.

## References

- [Repository upgrade orchestration](../../../roadmap/onboarding/repository-upgrade.md)
- [Host-wide full-cycle admission](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/resident-cycle/admission.md)
