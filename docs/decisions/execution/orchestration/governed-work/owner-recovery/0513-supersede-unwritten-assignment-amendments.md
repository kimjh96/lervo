# ADR-0513: Supersede unwritten assignment amendments and batch their retained-checkout proofs

Status: `accepted`
Decision date: 2026-10-13
Amends: [ADR-0406](../0406-supersede-unbound-claims-and-floor-completion-windows.md)

## Context

On 2026-10-13 the axli standing supervision admitted an assignment amendment (`osd_1aca81cfb38e05d8f9ddb077`) for an assignment with 21 retained, never-used checkouts. At 05:00:54 UTC the effect failed before writing anything, and its decision was recorded uncertain. After that, every cycle failed every 20 seconds with the same amendment error.

Two defects combined:

- **Proof timeouts.** The amendment source observed the 21 retained checkouts all at once. Each proof read the supervision history and workspace events itself. Live inspection showed every failed proof stopping at its five-second freshness bound (5.0 to 5.9 seconds). The same checkouts proved unstarted in 0.1 to 0.4 seconds through the bounded batch observer that owner reasoning uses. The responsibility-claim source had the same pattern.
- **No exit.** Each cycle's inspection retried an uncertain amendment and threw on refusal, so the pending decision never reached supersession. Amendments also had no supersession path or start-deadline port. ADR-0406 had fixed the same failure for responsibility claims only. After the amendment's start deadline passed (05:05:21), the retry could never succeed.

## Decision

- **Batched proofs.** `allUnstartedSupervisionWorkspaces` proves every retained checkout through the bounded batch observer: at most four Git inspections at a time over one shared evidence read. Assignment amendment and responsibility revision admission use it. Each proof keeps its own five-second freshness bound.
- **Bounded retry.** An uncertain amendment is retried only before the earlier of its plan deadline and its responsibility start deadline. If the retry is refused, inspection returns the receipt state instead of failing the cycle.
- **Shared supersession.** A never-written amendment is superseded on the same terms as an unbound claim:
  - its source changed or its start deadline passed;
  - under the owner fence;
  - with the deterministic `assignment.amended` event absent;
  - with the assignment record unchanged.

  The version-7 `work.effect_absence` inspection now covers `work.assignment_amendment.v1` as well as `work.responsibility_claim.v1`. The decision journal reads the amendment's start deadline to validate it. `readEffectStartDeadline` reports the amendment's start deadline.

## Consequences

An amendment the runtime cannot apply ends in one superseded decision, and the owner decides again over the current source. A cycle no longer fails indefinitely. Retained checkouts no longer fail their proofs because of how many there are. A proof that fails on its evidence still blocks the amendment.

## Verification

- `supervision-claim-supersession` test: an amendment refused before writing stays uncertain, is retried once inside its start window, and then, past the start deadline, is superseded once without another retry. The assignment is left unchanged.
- `supervision-unstarted-workspaces` test: 21 candidates are proven with four concurrent inspections and one shared evidence read, and one unproven candidate fails the whole set.
