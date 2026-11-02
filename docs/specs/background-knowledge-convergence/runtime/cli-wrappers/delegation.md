# Delegation

The [asset manifest authority contract](../ownership-and-activation/asset-manifest-authority.md) owns reviewed delegation and optional manifest application. The CLI uses read-only storage for previews and writable storage for application. It rejects an apply ID that differs from the newly generated plan ID. Neither preview nor application authors semantic review.

## Continuity commands

`lervo knowledge convergence delegation renewal-policy <show|install|revoke>` manages the host continuity policy. `install` and `revoke` print a `review_required` plan with the policy ID. They write the policy only with `--apply <policy-id>` and refuse a changed plan.

Installing a policy is optional: the first reviewed delegation on a host adopts one, and under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) the resident renews within its limits and rolls its horizon forward without an owner step. `lervo knowledge convergence delegation scope-response` is removed; it fails with one line that names `lervo knowledge revert <commit>`.

`lervo knowledge convergence delegation seed [--json]` runs one continuity reconciliation and prints `renewed`, `seeded`, or `unchanged` with the findings. See [fleet continuity](../ownership-and-activation/continuity.md).
