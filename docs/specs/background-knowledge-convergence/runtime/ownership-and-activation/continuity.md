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
4. Renew a due delegation at the same scope, or seed a missing one from the freshest in-policy peer scope or the template.
5. Publish this host's record, then write `.lervo/state/knowledge/convergence-continuity.json`.

The CLI worker (`lervo knowledge worker --watch|--once`) and the Node resident child both reconcile. A detached worker launched after a terminal turn reconciles too, off the hook's critical path.

`lervo knowledge worker --watch --host [--provider <codex|claude>]` is the host resident. It runs one ordinary resident for every checkout in `repositories.json` or `node-fleet.json` that no registered Node serves and that has a delegation or an active policy to seed one. It rescans every five minutes, starting residents for new checkouts and stopping them for removed ones.

## Owner-host derivation

| Current configuration                                  | Origin         | Action                                                             |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------ |
| Absent                                                 | Lervo          | Write one: Hub mode if a candidate probe succeeds, else standalone |
| `standalone`, label `local`, no publication, no marker | Legacy default | Migrate in place, keeping `hostId`                                 |
| Hash equals the derivation marker                      | Lervo          | Follow changed coordinates; enable publication when available      |
| Anything else                                          | Operator       | Never changed                                                      |

Candidates come from the owning Node's `hub` configuration for a Node resident. A CLI resident uses the Node registered for the checkout in `node-fleet.json`, then the Hub coordinates of other Hub-mode checkouts on the host, at most four. A probe is one host-record read; any failure keeps the candidate unused and records its `failureCode` as `owner_host_hub_unusable`.

Publication is added only in Hub mode. It requires `git remote get-url origin`, `git symbolic-ref refs/remotes/origin/HEAD`, and `gh auth status` to succeed. The settings are `origin`, the remote default branch, `lervo/knowledge-outputs`, `when_checks_pass`, and the default roots.

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

| Code                                                                | Severity                                                                  | Meaning                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `delegation_expiring`, `delegation_expired`                         | owner decision unless renewable                                           | No active policy can keep the delegation alive              |
| `delegation_outside_policy`                                         | owner decision                                                            | The scope exceeds the policy limits                         |
| `delegation_missing`                                                | attention under a policy, owner decision when a peer converges, else info | No delegation on this host                                  |
| `delegation_continuation_failed`                                    | attention                                                                 | A renewal or seed failed with the recorded code             |
| `policy_horizon_near`, `policy_invalid`                             | owner decision                                                            | Reinstall the policy                                        |
| `owner_host_hub_unusable`, `hub_unavailable`                        | attention                                                                 | Hub coordinates exist but refused or failed, with the cause |
| `peer_delegation_expiring`                                          | attention without a peer policy, else info                                | A peer host's grant lapses within 72 hours                  |
| `continuity_unobserved`, `continuity_stale`, `resident_not_running` | attention                                                                 | No resident reconciles this checkout                        |
| `hook_runtime_stale`                                                | attention                                                                 | The generated terminal hook runtime predates the CLI        |

Informational codes are `delegation_revoked`, `policy_absent`, `policy_revoked`, `owner_host_standalone`, `publication_unavailable`, `peer_delegation_missing`, and `peer_unreported`.

## Per-host rollout

1. Deploy the Hub first. Its new migration adds the host-record table, and the `sync.write` implication removes any credential grant.
2. Deploy the Node and CLI bundles to WSL and Mac with the existing recipes. On each host, replace any per-repository `lervo knowledge worker --watch` service (such as the Mac `com.lervo.mac.knowledge` job) with one `lervo knowledge worker --watch --host` service, then restart the Nodes.
3. On each host, the first resident cycle in a repository with a reviewed delegation adopts the policy. To install instead, run `lervo knowledge convergence delegation renewal-policy install` in a delegated repository, then rerun it with `--apply <policy-id>`.
4. Run `lervo knowledge convergence doctor` on each host. Every registered repository should show an active delegation, owner-host `hub` (or `operator` for lervo), and one `owner` with a `waiting_owner` peer.

The CLI and Node bundles also need a reader-first rollout for the new event type and attention kind: deploy every host before relying on cross-host records.
