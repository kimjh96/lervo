# ADR-0469: Keep background knowledge continuous on every host

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (host configuration, Hub permission), [ADR-0434](../../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) (delegation continuity)
Related: [ADR-0453](../conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md), [ADR-0451](../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0467](../../knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md), [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md)

## Context

The installed fleet on 2026-10-06 exposed gaps requiring manual owner action:

1. Every reviewed convergence delegation expires on a fixed date. Renewal required copying the grant, editing `expiresAt`, recomputing `planHash`, and running plan and apply on each host. Lapsed grants silently stopped all automatic knowledge work.
2. Delegation coverage varied: lervo, plen, and digimon on both hosts; axli and shiflo only on WSL; flemo and argo only on Mac. Work stalled when the ADR-0466 lease landed on a host without a grant.
3. Only lervo had a hand-written Hub-mode owner-host configuration. Other checkouts defaulted to `standalone`, allowing plen and digimon, delegated on both hosts, to double-own. Each project's Hub credential also required manual grants of `workspace.read` and `workspace.coordinate`.
4. `lervo upgrade` reported `pending_authority (provider_required)` for normalization debt already drained by the background resident, preventing upgrades from reaching `current`.

The owner's 2026-10-06 instruction requires automatic handling of existing and future projects on whichever host they occupy, Mac or WSL, without owner action or developer-flow disruption. Resolve cross-host conflicts through coordination, never host restriction.

## Decision

### Host continuity policy

A **host continuity policy** is the owner's standing consent for background knowledge on one host. It applies to every repository on that host and lives beside the host repository registry as `knowledge-continuity-policy.json` in the user state directory, mode `0600`. Version 1 contains:

- `state` (`active | revoked`), `authority`, `issuedAt`, and `horizonAt`, at most 366 days after issue. No continued delegation may expire after the horizon.
- `renewal`: `termDays` (1–90, default 30), `windowHours` (1–168, default 48), and `attentionLeadHours` (24–336, default 72).
- `seeding`: whether a missing delegation may be seeded from a peer host or the template.
- `limits`: allowed providers and maximum resource ceilings.
- `template`: default scope for a repository no host has delegated yet. It names parent and worker role IDs, roots, providers, integration ref, and ceilings, and uses the repository's own default verification suite.
- `policyHash` over the rest. The policy ID derives from its content.

`lervo knowledge convergence delegation renewal-policy install|revoke` is a plan/apply owner command; `show` prints the policy. `install` derives limits and template from the current repository's reviewed delegation, never exceeding an owner-reviewed scope.

The owner's 2026-10-06 instruction is the standing policy for hosts where the owner already reviewed a delegation. A resident finding an active reviewed delegation and no policy file adopts a policy derived from that delegation, with authority `owner_instruction` and reference `ADR-0469`. A revoked policy file blocks adoption; a host without a reviewed delegation adopts nothing.

### Same-scope renewal

Inside the renewal window, the resident renews its delegation under the policy. Scope, parent, and reviewer stay unchanged; only `expiresAt` (`min(now + term, horizon)`) and `review.reviewedAt` change, and `planHash` is recomputed. Renewal uses the ordinary plan/apply path, retaining role, suite, ancestry, and identity checks. Never renew when:

- the owner revoked the delegation;
- the policy is absent, revoked, or invalid;
- delegation providers or ceilings exceed policy limits; or
- the horizon prevents extension.

Any scope change still requires an owner-reviewed delegation.

### Seeding a missing host

Each resident publishes a **host record** through the Hub holding its ADR-0466 lease at `/v1/sync/projects/{projectId}/knowledge-convergence-hosts`. It carries the exchangeable delegation scope—everything except parent agent, review, term, and state—plus policy state, owner role, publication state, resident state, and closed finding codes. Agent identities, Hub addresses, token paths, and hostnames never leave the host. The Hub keeps one record per host, at most eight per repository identity; an older observation never replaces a newer one.

A host without a delegation may seed one under a policy allowing seeding:

- **From a peer:** use the freshest active peer scope within policy limits. Repository identity must match. Local role contracts, profiles, and capability bindings must resolve to the peer's exact hashes; the plan revalidates suites. Only the accountable agent is local: an active agent with the parent role contract, or a newly hired `Knowledge Steward` with that role. [ADR-0477](0477-carry-delegation-bound-definitions-across-hosts.md) amends this: before seeding, the host installs bound suites, repository roles, and the asset manifest it lacks from the exact reviewed bytes another host shared through the Hub.
- **From the template:** use roots present in this checkout, locally resolved role pins, and the repository's latest `repository.default.vN` suite (else `repository.default`, else its only non-pilot suite).

`lervo knowledge convergence delegation seed` runs the same reconciliation immediately.

### Zero-touch owner-host configuration

Each reconciliation derives `.lervo/state/knowledge/convergence-owner-host.json` when Lervo owns it. Ownership means the configuration is absent, is the legacy default (`standalone` with label `local` and no publication), or matches the hash in `.lervo/state/knowledge/convergence-owner-host-derivation.json`. Never rewrite operator-written configuration.

- Hub coordinates come from the Node running this checkout's resident. For a CLI resident, try the Node registered for the checkout, then other Hub-mode repositories on the host.
- Use a candidate only after a host-record read through it succeeds for this project. [ADR-0471](0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) amends the failure case: a refused or unreachable Hub leaves the checkout in Hub mode with unproven coordinates, so it stays read-only, never a standalone owner, and records the cause. Standalone remains available only without any Hub coordinates (invariant 1).
- Generate the host ID once and keep it. The label is `mac`, `wsl`, or the sanitized hostname.
- In Hub mode, enable publication with ADR-0466 defaults when the checkout has an `origin` remote with a known default branch and the host's `gh` is authenticated. Repeat that check at most every six hours.
- If coordinates disappear from every source, leave an existing Hub configuration unchanged.

### Hub permission for knowledge coordination

The Hub accepts `sync.write` in place of `workspace.read` and `workspace.coordinate` only on the three knowledge coordination routes: owner lease, instruction candidates, and host records. Project scope checks remain unchanged; workspace reservations still require explicit permissions. A Node allowed to write a project's events may coordinate that project's background knowledge, a weaker effect. This requires no credential-file edit, restart, or backup and cannot leave the Hub unable to start.

### Upgrade honesty

When `lervo upgrade` encounters `provider_required` normalization debt, report the knowledge stage as `current (background_owned)` with the pending-document count if an active delegation exists or an active policy allows the resident to seed one. Keep `provider_required` as `pending_authority` only when no automatic owner exists or the owner revoked the delegation.

### Fleet doctor and attention

`lervo knowledge convergence doctor [--json]` reports every repository in the host registry and Node fleet registry, plus the current repository. For each, check delegation, policy, owner-host mode and cause, Hub reachability, lease role and holder, publication health, resident heartbeat, terminal hook runtime freshness, and replica divergence. Read peers live from the Hub. Every finding carries an exact remediation.

`lervo application attention` projects findings needing attention as non-blocking `knowledge_convergence_continuity` items. Only an authority or scope decision sets `requiresUserAction`.

### Default onboarding

On a host with an active policy:

- `lervo init` registers the checkout in the host registry and reconciles once. Reconciliation derives owner-host configuration and seeds delegation, so onboarding reports `background_owned` instead of a provider decision.
- `lervo repository register --write` runs the same reconciliation.
- A Node starts a resident for a checkout without a delegation, using the policy's provider, and supplies its Hub coordinates.
- Without a Node, `lervo knowledge worker --watch --host` runs one resident per registered checkout that has a delegation or that the policy can seed. It rescans registries every five minutes so newly registered checkouts receive residents without a restart.
- The resident's first cycle reconciles before observing ownership, then claims the lease or waits for the holder with an active delegation.
- Doctor coverage follows from the registries.

### Rollout to existing repositories

After deployment, each host's first resident cycle with a reviewed delegation adopts the policy. Each host runs its Nodes and one host resident in place of per-repository knowledge jobs. Residents renew due delegations, migrate legacy standalone defaults to Hub mode where their Node's coordinates work, and seed missing delegations from peer host records. Hand-written configurations remain unchanged; the [continuity specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md) defines per-host migration.

## Events, states, and failure meaning

`knowledge.convergence.delegation.continued` (event schema 4) records each renewal or seed:

- Required fields: `repositoryIdentityHash`, `action` (`renewed | seeded`), `source` (`renewal | peer | policy_template`), `policyHash`, `previousPlanHash` or null, `planHash`, `scopeHash`, `expiresAt`, `observerHostHash` or null, `sourceHostHash` or null, `occurredAt`.
- Privacy: hashes and the expiry only.
- Event ID derives from `planHash`, deduplicating retried appends. The applied delegation and its materialization receipt grant authority; append failure loses only this audit line.

Private state:

- `.lervo/state/knowledge/convergence-continuity.json`: last reconciliation, next due time, delegation and policy state, owner-host state and Hub cause, last continuation, failure record, up to eight peer summaries, and up to 32 findings. It is rebuildable.
- `.lervo/state/knowledge/convergence-owner-host-derivation.json`: hash of the configuration Lervo wrote, its source, and the last publication check.

Both files use `0600`, contain no addresses, token paths, or messages, and never replicate.

Failure codes:

- `convergence_continuity_policy_invalid`
- `convergence_seed_parent_missing`
- `convergence_seed_role_mismatch`
- `convergence_seed_roots_missing`
- `convergence_seed_verification_missing`
- `convergence_seed_identity_mismatch`
- `convergence_continuity_horizon_exhausted`

Plan and binding failures retain existing codes. Failed steps retry after 15 minutes; healthy hosts reconcile hourly and at renewal time. Failure never blocks the resident cycle, hook path, or developer's branch: continuity writes only host-local state and the delegation through its journal.

## Consequences

- Delegations stay current without owner action. Lapses, scope changes, and an ending horizon surface 72 hours ahead as one owner decision each.
- Every host converges the same repositories; the lease, not host restriction, selects the owner.
- Node credentials coordinate knowledge for their projects without credential changes.
- Upgrades and onboarding report background-owned debt truthfully.
- Doctor and attention expose every remaining gap and its remedy.

## Deferred

- Hub-mediated policy distribution; each host holds its own policy.
- Automatic refresh of stale generated hook runtime, which writes tracked bytes outside the publication path.
