# Fleet continuity

[ADR-0469](../../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) keeps background knowledge working on every repository and host without per-repository setup. This page defines the policy file, the reconciliation each resident runs, the commands, and the per-host rollout.

## Host policy

`knowledge-continuity-policy.json` sits in the host user state directory, next to `repositories.json`: `$LERVO_USER_STATE_DIRECTORY`, `~/Library/Application Support/Lervo` on macOS, or `$XDG_STATE_HOME/lervo` (default `~/.local/state/lervo`) on Linux and WSL. It is owner-only and at most 16 KiB.

```json
{
  "schemaVersion": 1,
  "policyId": "kcpol_<24 hex>",
  "state": "active",
  "authority": { "kind": "owner_installed", "reference": null },
  "issuedAt": "2026-10-06T00:00:00.000Z",
  "horizonAt": "2027-10-06T00:00:00.000Z",
  "renewal": { "termDays": 30, "windowHours": 48, "attentionLeadHours": 72 },
  "seeding": { "fromPeer": true, "fromTemplate": true },
  "limits": {
    "providers": ["codex"],
    "resourceCeilings": {
      "maximumStages": 8,
      "maximumDocuments": 8,
      "maximumSourceBytes": 1048576,
      "maximumProviderCalls": 8
    }
  },
  "template": {
    "parentRoleId": "developer",
    "roleIds": {
      "generator": "developer",
      "reviewer": "developer",
      "writer": "developer",
      "integrator": "developer"
    },
    "canonicalRoots": ["docs", "README.md", "AGENTS.md", "CLAUDE.md"],
    "normalizationRoots": ["docs", "README.md", "AGENTS.md", "CLAUDE.md"],
    "providers": ["codex"],
    "integrationRef": "refs/heads/lervo/knowledge-integration",
    "resourceCeilings": {
      "maximumStages": 8,
      "maximumDocuments": 8,
      "maximumSourceBytes": 1048576,
      "maximumProviderCalls": 8
    },
    "verificationSuite": "repository_default"
  },
  "policyHash": "sha256:<64 hex>"
}
```

An adopted policy has authority `{ "kind": "owner_instruction", "reference": "ADR-0469" }` and the scope of the reviewed delegation it was adopted from.

## Reconciliation

A resident reconciles before each ownership observation. A healthy reconciliation runs at most hourly and again at the delegation's renewal time; a failed step retries after 15 minutes. It runs under the repository knowledge worker lock and skips the round if a cycle holds the lock. Steps:

1. Derive the owner-host configuration from the candidate Hub coordinates (below).
2. Read peer host records through the Hub when the checkout is in Hub mode.
3. Adopt the standing policy when the host has none and this checkout holds an active reviewed delegation.
4. Rebind a delegation whose bound suite or role hashes drifted while every identifier stayed the same (`rebound`, source `binding_refresh`, ADR-0471). Otherwise renew a due delegation at the same scope, or seed a missing one from the freshest in-policy peer scope or the template.
5. Publish this host's record, then write `.lervo/state/knowledge/convergence-continuity.json`.

The CLI worker (`lervo knowledge worker --watch|--once`) and the Node resident child both reconcile. A detached worker launched after a terminal turn reconciles too, off the hook's critical path.

`lervo knowledge worker --watch --host [--provider <codex|claude>]` is the host resident. It runs one ordinary resident for every checkout in `repositories.json` or `node-fleet.json` that no registered Node serves and that has a delegation or an active policy to seed one. It rescans every five minutes, starting residents for new checkouts and stopping them for removed ones.

Under [ADR-0470](../../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), a checkout whose event writer is older than schema 4 is never skipped silently. The host resident runs the local-only writer activation (backup, then the exact plan) and starts the resident. When activation is blocked, it holds the checkout: an `attention` heartbeat with reason `event_schema_outdated`, retried every 30 minutes. A Node's resident child holds the same way and resumes when `lervo upgrade` activates the writer. The host resident records every checkout's state in `knowledge-host-resident.json` and serves only while it holds `knowledge-host-resident.lock`. `lervo upgrade` installs and keeps current its service (`com.lervo.knowledge.host` or `lervo-knowledge-host.service`).

## Owner-host derivation

| Current configuration                                  | Origin         | Action                                                                                                  |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------- |
| Absent                                                 | Lervo          | Write one: Hub mode with the first proven candidate, else the first unproven candidate, else standalone |
| `standalone`, label `local`, no publication, no marker | Legacy default | Migrate in place, keeping `hostId`                                                                      |
| Hash equals the derivation marker                      | Lervo          | Follow changed coordinates; enable and revalidate publication                                           |
| Anything else                                          | Operator       | Never changed                                                                                           |

Candidates come from the owning Node's `hub` configuration for a Node resident. A CLI resident uses, at most four in this order: the Node registered for the checkout in `node-fleet.json`; the Hub block of `nodes/<projectId>/config.json`; this project's `nodes/<projectId>/secrets/hub-sync.token` paired with each Hub other Hub-mode checkouts on the host use; then those checkouts' coordinates as written. `nodes/` sits beside the user state directory, and on Linux also under `$XDG_CONFIG_HOME/lervo/nodes`. A probe is one host-record read.

Under [ADR-0471](../../../../decisions/coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md), when every candidate fails its probe, derivation writes Hub mode with the first candidate and marks it `unproven`. The lease then reports `unverifiable`, the host stays read-only, and the state records the cause as `owner_host_hub_unusable`. Unproven coordinates are probed again at every reconciliation. A host never falls back to standalone, which owns unconditionally, while Hub coordinates exist. Standalone mode is only for hosts without any.

Publication is added only in Hub mode. It requires `git remote get-url origin`, `git ls-remote --symref origin HEAD`, and `gh auth status` to succeed. The settings are `origin`, the default branch the remote advertises, `lervo/knowledge-outputs`, `when_checks_pass`, and `scope: "delegation"`. The local `refs/remotes/origin/HEAD` is never consulted: it can be missing or name a feature branch.

Under [ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md), the probe also runs every six hours for a derived configuration that already publishes. A different base branch replaces the derived one, and a failed probe keeps it. A derived setting that still holds the old default roots (`docs/` and `.lervo/knowledge/`) becomes `scope: "delegation"` at the next reconciliation, without a probe.

### Migrating hand-written configurations

A hand-written configuration stays operator-owned. To hand it to Lervo, delete `.lervo/state/knowledge/convergence-owner-host.json` and run `lervo knowledge convergence delegation seed`. The next reconciliation writes a derived file with a new host identity. While the previous holder's lease is live, run `lervo knowledge convergence owner release` first so the new identity can claim. To keep a hand-written Hub configuration, make no change: residents still renew and seed delegations and publish host records under it.

## Commands

| Command                                                                                                                                              | Effect                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lervo knowledge convergence delegation renewal-policy show`                                                                                         | Print the host policy reading (`absent`, `invalid`, or `loaded`)                                              |
| `... renewal-policy install [--term-days N] [--window-hours N] [--horizon-days N] [--no-peer-seeding] [--no-template-seeding] [--apply <policy-id>]` | Plan, then apply, a policy derived from this repository's reviewed delegation; same-day plans are exact       |
| `... renewal-policy revoke [--apply <policy-id>]`                                                                                                    | Plan, then apply, revocation                                                                                  |
| `lervo knowledge convergence delegation seed [--json]`                                                                                               | Run one reconciliation now and print the outcome                                                              |
| `lervo knowledge convergence doctor [--json]`                                                                                                        | Report every repository on this host, with peers read live from the Hub; exit 1 when anything needs attention |

Installing or revoking the policy is owner work, once per host. Renewal, seeding, and configuration derivation under an active policy ask nobody.

## Findings

The doctor reports every finding. `lervo application attention` reports those of severity `attention` or `owner_decision` as `knowledge_convergence_continuity` items, except lease, publication, and replica findings, which keep their own items. Only `owner_decision` findings require the user, and no finding blocks.

| Code                                                                | Severity                                                                  | Meaning                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `delegation_expiring`, `delegation_expired`                         | owner decision unless renewable                                           | No active policy can keep the delegation alive               |
| `delegation_outside_policy`                                         | owner decision                                                            | The scope exceeds the policy limits                          |
| `delegation_missing`                                                | attention under a policy, owner decision when a peer converges, else info | No delegation on this host                                   |
| `delegation_continuation_failed`                                    | attention                                                                 | A renewal or seed failed with the recorded code              |
| `policy_horizon_near`, `policy_invalid`                             | owner decision                                                            | Reinstall the policy                                         |
| `owner_host_hub_unusable`, `hub_unavailable`                        | attention                                                                 | Hub coordinates exist but refused or failed, with the cause  |
| `peer_delegation_expiring`                                          | attention without a peer policy, else info                                | A peer host's grant lapses within 72 hours                   |
| `continuity_unobserved`, `continuity_stale`, `resident_not_running` | attention                                                                 | No resident reconciles this checkout                         |
| `hook_runtime_stale`                                                | attention                                                                 | The generated terminal hook runtime predates the CLI         |
| `event_schema_outdated`                                             | attention                                                                 | A resident is held because the writer is older than schema 4 |

Informational codes are `continuity_pending` (the host resident serves the checkout but has not reconciled yet), `delegation_revoked`, `policy_absent`, `policy_revoked`, `owner_host_standalone`, `publication_unavailable`, `peer_delegation_missing`, and `peer_unreported`.

## Per-host rollout

1. Deploy the Hub first. Its new migration adds the host-record table, and the `sync.write` implication removes any credential grant.
2. Deploy the Node and CLI bundles to WSL and Mac with the existing recipes. On each host, remove any per-repository `lervo knowledge worker --watch` service (such as the Mac `com.lervo.mac.knowledge` job) and any hand-written host resident service, then run `lervo upgrade` in a registered repository and apply its plan. Its `host_service` stage installs the one managed host resident service, and its `event_writer` stage activates schema 4. Restart the Nodes.
3. On each host, the first resident cycle in a repository with a reviewed delegation adopts the policy. To install instead, run `lervo knowledge convergence delegation renewal-policy install` in a delegated repository, then rerun it with `--apply <policy-id>`.
4. Run `lervo knowledge convergence doctor` on each host. Every registered repository should show an active delegation, owner-host `hub` (or `operator` for lervo), and one `owner` with a `waiting_owner` peer.

The CLI and Node bundles also need a reader-first rollout for the new event type and attention kind: deploy every host before relying on cross-host records.
