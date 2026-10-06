# ADR-0469: Keep background knowledge continuous on every host

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (host configuration, Hub permission), [ADR-0434](../../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) (delegation continuity)
Related: [ADR-0453](../conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md), [ADR-0451](../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0467](../../knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md), [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md)

## Context

The installed fleet on 2026-10-06 showed that each earlier fix left a gap the owner had to close by hand:

1. Every reviewed convergence delegation expires on a fixed date. Renewal meant copying the grant, editing `expiresAt`, recomputing `planHash`, and running plan and apply on each host. When a grant lapsed, all automatic knowledge work stopped and nothing said so.
2. Delegation coverage differed per host: lervo, plen, and digimon on both; axli and shiflo only on WSL; flemo and argo only on Mac. When the ADR-0466 lease landed on a host without a grant, work stalled.
3. Only lervo had a hand-written Hub-mode owner-host configuration. Every other checkout defaulted to `standalone`, so plen and digimon, delegated on both hosts, could double-own. Each project's Hub credential also needed `workspace.read` and `workspace.coordinate` granted by hand.
4. `lervo upgrade` reported `pending_authority (provider_required)` for normalization debt that the background resident already drained, so upgrades never reached `current`.

The owner instructed on 2026-10-06: existing and future projects must be handled automatically on whichever host they live, Mac or WSL, with no owner action and without disrupting developer flow. Conflicts between hosts are resolved through coordination, never host restriction.

## Decision

### Host continuity policy

A **host continuity policy** is the owner's standing consent for background knowledge on one host. It lives beside the host repository registry (`knowledge-continuity-policy.json` in the user state directory, mode `0600`) and applies to every repository on that host. Version 1 holds:

- `state` (`active | revoked`), `authority`, `issuedAt`, and `horizonAt`, at most 366 days after issue. No continued delegation may expire after the horizon.
- `renewal`: `termDays` (1–90, default 30), `windowHours` (1–168, default 48), and `attentionLeadHours` (24–336, default 72).
- `seeding`: whether a missing delegation may be seeded from a peer host or from the template.
- `limits`: allowed providers and maximum resource ceilings.
- `template`: the default scope for a repository that no host has delegated yet. It names the parent and worker role IDs, roots, providers, integration ref, and ceilings, and uses the repository's own default verification suite.
- `policyHash` over the rest. The policy ID derives from its content.

`lervo knowledge convergence delegation renewal-policy install|revoke` is a plan/apply owner command, and `show` prints the policy. `install` derives the limits and template from the current repository's reviewed delegation, so the policy never exceeds a scope the owner already reviewed.

The owner's 2026-10-06 instruction is the standing policy for hosts where the owner already reviewed a delegation. When a resident finds an active reviewed delegation and no policy file at all, it adopts a policy derived from that delegation with authority `owner_instruction` and reference `ADR-0469`. A revoked policy file blocks adoption, and a host with no reviewed delegation adopts nothing.

### Same-scope renewal

Inside the renewal window, the resident renews its delegation under the policy. The scope, parent, and reviewer stay unchanged; only `expiresAt` (`min(now + term, horizon)`) and `review.reviewedAt` change, and `planHash` is recomputed. The renewal goes through the ordinary plan/apply path, so role, suite, ancestry, and identity checks still run. Renewal never happens when:

- the owner revoked the delegation;
- no policy exists, or it is revoked or invalid;
- the delegation's providers or ceilings exceed the policy limits; or
- the horizon prevents extension.

Any scope change still requires an owner-reviewed delegation.

### Seeding a missing host

Each resident publishes a **host record** through the Hub that holds its ADR-0466 lease, at `/v1/sync/projects/{projectId}/knowledge-convergence-hosts`. The record carries the exchangeable delegation scope: everything except parent agent, review, term, and state. It also carries the policy state, owner role, publication state, resident state, and closed finding codes. Agent identities, Hub addresses, token paths, and hostnames never leave the host. The Hub keeps one record per host, at most eight per repository identity, and an older observation never replaces a newer one.

A host without a delegation, under a policy that allows seeding, seeds one:

- **From a peer**: the freshest active peer scope within the policy limits. The repository identity must match. The local role contracts, profiles, and capability bindings must resolve to the peer's exact hashes, and the plan revalidates suites. Only the accountable agent is local: an active agent with the parent role contract, or a newly hired `Knowledge Steward` with that role.
- **From the template**: roots that exist in this checkout, role pins resolved locally, and the repository's latest `repository.default.vN` suite (else `repository.default`, else its only non-pilot suite).

`lervo knowledge convergence delegation seed` runs the same reconciliation immediately.

### Zero-touch owner-host configuration

Each reconciliation derives `.lervo/state/knowledge/convergence-owner-host.json` when Lervo owns it. Lervo owns a configuration that is absent, is the legacy default (`standalone` with label `local` and no publication), or matches the hash in `.lervo/state/knowledge/convergence-owner-host-derivation.json`. It never rewrites an operator-written configuration.

- Hub coordinates come from the Node that runs this checkout's resident, or, for a CLI resident, from the Node registered for the checkout and then from other Hub-mode repositories on the host.
- A candidate is used only after a host-record read through it succeeds for this project. A refused or unreachable Hub leaves a working checkout `standalone` and records the cause. Standalone mode remains for checkouts without usable Hub coordinates (invariant 1).
- The host ID is generated once and kept. The label is `mac`, `wsl`, or the sanitized hostname.
- In Hub mode, publication is enabled with the ADR-0466 defaults when the checkout has an `origin` remote with a known default branch and the host's `gh` is authenticated. That check repeats at most every six hours.
- Coordinates that disappear from every source leave an existing Hub configuration unchanged.

### Hub permission for knowledge coordination

The Hub accepts `sync.write` in place of `workspace.read` and `workspace.coordinate` on the three knowledge coordination routes only: owner lease, instruction candidates, and host records. The project scope check is unchanged, and workspace reservations still need their explicit permissions. A Node that may write a project's events may coordinate that project's background knowledge, which is a weaker effect. This needs no credential-file edit, restart, or backup, so it cannot leave the Hub unable to start.

### Upgrade honesty

When `lervo upgrade` meets `provider_required` normalization debt, it reports the knowledge stage as `current (background_owned)` with the pending-document count if an active delegation exists, or if an active policy lets the resident seed one. `provider_required` remains `pending_authority` only when no automatic owner exists or the owner revoked the delegation.

### Fleet doctor and attention

`lervo knowledge convergence doctor [--json]` reports every repository in the host registry and Node fleet registry, plus the current one. For each, it checks the delegation, policy, owner-host mode and cause, Hub reachability, lease role and holder, publication health, resident heartbeat, terminal hook runtime freshness, and replica divergence. It reads peers live from the Hub. Every finding carries an exact remediation. `lervo application attention` projects the same findings that need attention as non-blocking `knowledge_convergence_continuity` items. Only an authority or scope decision sets `requiresUserAction`.

### Default onboarding

On a host with an active policy:

- `lervo init` registers the checkout in the host registry and runs one reconciliation. The reconciliation derives the owner-host configuration and seeds the delegation, so onboarding reports `background_owned` instead of a provider decision.
- `lervo repository register --write` runs the same reconciliation.
- A Node starts a resident for a checkout with no delegation yet, using the policy's provider, and hands the resident its Hub coordinates.
- Without a Node, the host resident `lervo knowledge worker --watch --host` runs one resident for every registered checkout that has a delegation or that the policy can seed. It rescans the registries every five minutes, so a newly registered checkout gets a resident without a restart.
- The resident's first cycle reconciles before observing ownership, so it claims the lease or waits for the holder with an active delegation.
- Doctor coverage follows from the registries.

### Rollout to existing repositories

After deployment, each host's first resident cycle with a reviewed delegation adopts the policy. Each host runs its Nodes and one host resident in place of per-repository knowledge jobs. Every resident then renews due delegations, migrates legacy standalone defaults to Hub mode where its Node's coordinates work, and seeds missing delegations from the peer host's record. Hand-written configurations stay as written; the [continuity specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md) gives the per-host migration.

## Events, states, and failure meaning

`knowledge.convergence.delegation.continued` (event schema 4) records each renewal or seed:

- Required fields: `repositoryIdentityHash`, `action` (`renewed | seeded`), `source` (`renewal | peer | policy_template`), `policyHash`, `previousPlanHash` or null, `planHash`, `scopeHash`, `expiresAt`, `observerHostHash` or null, `sourceHostHash` or null, `occurredAt`.
- Privacy: hashes and the expiry only.
- The event ID derives from `planHash`, so a retried append is deduplicated. The applied delegation and its materialization receipt grant authority; an append failure loses only this audit line.

Private state:

- `.lervo/state/knowledge/convergence-continuity.json`: the last reconciliation, next due time, delegation and policy state, owner-host state and Hub cause, last continuation, failure record, up to eight peer summaries, and up to 32 findings. It is rebuildable.
- `.lervo/state/knowledge/convergence-owner-host-derivation.json`: hash of the configuration Lervo wrote, its source, and the last publication check.

Both are `0600`, hold no addresses, token paths, or messages, and never replicate.

Failure codes:

- `convergence_continuity_policy_invalid`
- `convergence_seed_parent_missing`
- `convergence_seed_role_mismatch`
- `convergence_seed_roots_missing`
- `convergence_seed_verification_missing`
- `convergence_seed_identity_mismatch`
- `convergence_continuity_horizon_exhausted`

Plan and binding failures keep their existing codes. A failed step retries after 15 minutes; a healthy host reconciles hourly and at its renewal time. A failure never blocks the resident cycle, the hook path, or the developer's branch: continuity writes only host-local state and the delegation through its journal.

## Consequences

- Delegations stay current without the owner. Lapses, scope changes, and an ending horizon surface 72 hours ahead as one owner decision each.
- Every host converges the same repositories; the lease, not host restriction, picks the owner.
- Node credentials coordinate knowledge for their projects without a credential change.
- Upgrades and onboarding report background-owned debt truthfully.
- The doctor and attention show every remaining gap with its remedy.

## Deferred

- Hub-mediated policy distribution; each host holds its own policy.
- Automatic refresh of a stale generated hook runtime, which writes tracked bytes outside the publication path.
