# ADR-0405: Start successor goals under a reviewed standing grant

- Status: accepted
- Decision date: 2026-09-15

## Context

[ADR-0401](0401-bind-installed-supervision-requests-across-surfaces.md) binds one request to the current reviewed goal. Every later `/goal` needed a human to author a successor workstream, plan a new mandate, approve its exact hash, install it on the execution host, and rewrite the Node configuration to the new binding. Installed Discord acceptance ran seventeen such transitions by hand. Between them the owner refused every request with `workstream_inactive` or, after the pinned mandate expired, reported `supervision_authority_unavailable`, so the product owner was unusable for most of each day although nothing about its authority had changed.

## Decision

Operating mandate version 3 gains an optional reviewed `successorAuthority` with `maximumSuccessors` between 1 and 1024. A mandate carrying it is a standing grant: the installed owner may derive successor mandates from it without a new review, one per successor goal.

A derived mandate is fully determined by its parent and the successor goal's start snapshot. It keeps the parent's owner, appointing authority, execution host, bounds, ceilings, expiry, and revocation prefix; it takes mandate ID `<parent>.s<n>` and revocation coordinate `<parent>.s<n>`, version 1, the successor goal's workstream as its exact work scope with no exclusions, and `maximumSuccessors` decremented until the grant is exhausted. It cannot widen, extend, or outlive its parent, and it cannot re-anchor an existing goal. The installation plan carries a `derivation` naming the parent installation event, parent mandate hash, and successor index; that derivation is part of the plan's approval hash. The mandate journal admits a derived plan only when the parent installation exists in the same project, is unrevoked, names the same owner, sits one lineage index earlier, and derives exactly the presented mandate. Supervision IDs follow the same `<root>.s<n>` lineage.

Node configuration selects a standing lineage with `outcomeSupervision.standing` instead of `binding`. The runtime resolves the lineage at startup by walking the successor installations and verifying every derivation against its parent, then opens the latest successor. Standing intake binds under that goal; when the goal is settled (`completed` or `cancelled` with no blockers, pending decisions, or approvals) and the grant has a remaining successor, the same intake starts the next goal: a successor workstream whose objective is the bound request, recorded as `workstream.snapshot.recorded` with the agent actor and provider, then the derived mandate installed under the successor's own owner fence, then the ordinary `work.supervision.bound` under the new binding. The service rebinds to the new goal without a restart, and a running service also follows a successor another process started under the same grant, which it notices by scanning new events after each owner cycle. An active goal still refuses a second origin with `origin_conflict`; an exhausted grant refuses with `workstream_inactive`; no new event type or refusal code is introduced.

## Consequences

One human review authorizes a bounded number of consecutive goals under unchanged ceilings, so the installed product owner answers `/goal` continuously until the grant or the expiry runs out. Each goal remains a distinct workstream with its own mandate, installation review, and evidence; revoking the root or any intermediate mandate stops further derivation from it. Widening ceilings, changing the host, or extending the expiry still requires a separately reviewed installation.

## Verification

- `mandate-successor` tests: lineage identifiers, exact derivation, and rejection of a widened or re-indexed child.
- `supervision-standing` integration test: a standing root with two successors accepts a request, refuses a second origin on the active goal, starts `.s1` and `.s2` after each completion with the derived mandates installed and bound, and refuses beyond the grant.
- `supervision-standing` service test: a running standing service rebinds to `.s1` within seconds after another process started that successor.
- Installed acceptance: the WSL scoped service configured with `standing` answers consecutive guild `/goal` requests without a manual transition.

## References

- [ADR-0401](0401-bind-installed-supervision-requests-across-surfaces.md)
- [Reviewed goal scope](../../../../specifications/execution/outcome-supervision/contracts/work-scope.md)
- [Installed request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)
