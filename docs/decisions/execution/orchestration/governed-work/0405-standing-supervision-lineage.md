# ADR-0405: Start successor goals under a reviewed standing grant

- Status: accepted
- Decision date: 2026-09-15

## Context

[ADR-0401](0401-bind-installed-supervision-requests-across-surfaces.md) binds one request to the current reviewed goal. Each later `/goal` required a human to author a successor workstream, plan a new mandate, approve its exact hash, install it on the execution host, and rewrite the Node configuration to the new binding. Installed Discord acceptance performed seventeen such transitions manually. Between transitions, the owner refused every request with `workstream_inactive` or, after the pinned mandate expired, reported `supervision_authority_unavailable`. The product owner was therefore unusable for most of each day despite unchanged authority.

## Decision

Operating mandate version 3 gains optional reviewed `successorAuthority` with `maximumSuccessors` between 1 and 1024. A mandate carrying it is a standing grant: the installed owner may derive one mandate per successor goal without a new review. The compatible version-2 successor authority additionally pins `maximumAggregateTokens` for each derived goal, independently of a larger ceiling reviewed for the current goal.

A derived mandate is fully determined by its parent and the successor goal's start snapshot:

- Preserve the parent's owner, appointing authority, execution host, bounds, expiry, and revocation prefix. Version 1 preserves the current aggregate ceiling; version 2 applies its separately reviewed successor aggregate ceiling.
- Use mandate ID `<parent>.s<n>` and revocation coordinate `<parent>.s<n>`, version 1.
- Use the successor goal's workstream as the exact work scope, with no exclusions.
- Decrement `maximumSuccessors` until the grant is exhausted.

A derived mandate cannot widen, extend, or outlive its parent or re-anchor an existing goal. The installation plan carries a `derivation` naming the parent installation event, parent mandate hash, and successor index; this derivation is part of the plan's approval hash. The mandate journal admits a derived plan only if the parent installation exists in the same project, is unrevoked, names the same owner, sits one lineage index earlier, and derives exactly the presented mandate. Supervision IDs follow the same `<root>.s<n>` lineage.

Node configuration selects a standing lineage with `outcomeSupervision.standing` instead of `binding`. At startup, the runtime walks successor installations to resolve the lineage. Each successor's creating installation must carry a derivation naming an installation of the preceding lineage supervision under the same owner. The runtime then opens that successor's latest installed mandate.

A later reviewed version of a successor's own mandate is an ordinary succession, not a second derivation. Operators can therefore revise a running goal's mandate, such as widening its attempt ceiling, without breaking the lineage. That revision is planned and revalidated against the mandate's exact V3 work-scope workstream even when a different repository workstream is current. Current-workstream projection changes neither invalidate the pinned anchor nor redirect the authority.

The configured root hash remains an immutable ancestry pin. A later reviewed revision of that same root mandate is also followed without rewriting the Node configuration: the runtime requires the configured hash to be one of the root's installations, validates the complete mandate-journal succession and exact owner/workstream binding, then selects the latest reviewed root installation at or after it. A configuration written against a later revision therefore stays valid after an upgrade (amended 2026-09-25, after the axli and digimon Nodes failed to start with `supervision_binding_invalid`), and a revision installed before the pin is never selected. An unrelated root hash or invalid succession fails closed. A running standing service detects the installation event and rebinds to the revised hash before using the new limit; installing an artifact alone does not prove the new authority was consumed.

If another authority makes a workstream outside the reviewed standing lineage current, the pinned owner becomes dormant rather than reporting a failed supervision cycle every polling interval. It checks for a valid successor on repository change and at a bounded one-minute fallback, and resumes only after the reviewed lineage exists. Other cycle errors remain unavailable health with their exact failure code.

The 2026-09-19 health amendment reports this settled dormancy as `supervision: { status: "dormant", reasonCode: "workstream_inactive" }`, distinct from startup `pending`. The Node may be operationally ready while this component is dormant; neither status grants authority to work on the unrelated current workstream or proves that the pinned owner is executing. Fleet status must expose the component instead of hiding it behind aggregate readiness.

Standing intake binds under that goal. When the goal is settled (`completed` or `cancelled` with no blockers, pending decisions, or approvals) and the grant has a remaining successor, the same intake starts the next goal in order:

1. Create a successor workstream whose objective is the bound request, recorded as `workstream.snapshot.recorded` with the agent actor and provider.
2. Install the derived mandate under the successor's own owner fence.
3. Perform the ordinary `work.supervision.bound` under the new binding.

The service rebinds to the new goal without restarting. A running service also follows a successor started by another process under the same grant, detected by scanning new events after each owner cycle. An active goal still refuses a second origin with `origin_conflict`; an exhausted grant refuses with `workstream_inactive`. No new event type or refusal code is introduced.

## Consequences

One human review authorizes a bounded number of consecutive goals under unchanged reviewed successor ceilings, allowing the installed product owner to answer `/goal` continuously until the grant or expiry runs out. Each goal remains a distinct workstream with its own mandate, installation review, and evidence. Revoking the root or any intermediate mandate stops further derivation from it. Widening ceilings, changing the host, or extending expiry still requires a separately reviewed installation. A reviewed renewal can increase the current goal's aggregate ceiling while retaining a smaller fixed ceiling for all later goals; automatic succession cannot copy that exceptional increase when version-2 successor authority is present.

## Verification

- `mandate-successor` tests cover lineage identifiers, exact derivation, and rejection of a widened or re-indexed child.
- `supervision-standing` integration test: a standing root with two successors accepts a request, refuses a second origin on the active goal, starts `.s1` and `.s2` after each completion with derived mandates installed and bound, and refuses beyond the grant.
- `supervision-standing` service test: a running standing service rebinds to `.s1` within seconds after another process starts that successor.
- Root-revision regression: a configuration pinned to the first or a later root installation resolves the latest reviewed version at or after it; an unrelated pin is rejected.
- Installed acceptance: the WSL scoped service configured with `standing` answers consecutive guild `/goal` requests without a manual transition.

## References

- [ADR-0401](0401-bind-installed-supervision-requests-across-surfaces.md)
- [Reviewed goal scope](../../../../specifications/execution/outcome-supervision/contracts/work-scope.md)
- [Installed request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)
