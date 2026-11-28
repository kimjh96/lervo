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
4. On the convergence owner only, rebind a delegation whose bound suite or role hashes drifted while every identifier stayed the same (`rebound`, source `binding_refresh`, ADR-0471), or else renew a due delegation at the same scope. A follower adopts the owner's term or waits for the replica (below). Any host seeds a missing delegation from the freshest in-policy peer scope or the template. Before seeding from a peer, install the bound definitions this checkout lacks (below). A template seed in a repository without a suite it can bind first installs Lervo's default suite, `.lervo/verifications/lervo.default.knowledge.yaml`, which runs `lervo knowledge lint` ([ADR-0655](../../../../decisions/knowledge/semantics/0655-give-a-repository-without-a-suite-a-default-knowledge-suite.md)). A peer seed whose scope binds that suite installs it the same way. An owner's `repository.default*` or single other suite always takes precedence. A delegation bound to the default rebinds to it once one exists. With several other suites and no `repository.default*`, nothing is installed and the seed fails with `convergence_seed_verification_ambiguous`.
5. Publish the definitions this host's active delegation binds and reproduces, then this host's record, then write `.lervo/state/knowledge/convergence-continuity.json`.

The CLI worker (`lervo knowledge worker --watch|--once`) and the Node resident child both reconcile. A detached worker launched after a terminal turn reconciles too, off the hook's critical path.

`lervo knowledge worker --watch --host [--provider <codex|claude>]` is the host resident. It runs one ordinary resident for every checkout in `repositories.json` or `node-fleet.json` that no registered Node serves and that has a delegation or an active policy to seed one. It rescans every five minutes, starting residents for new checkouts and stopping them for removed ones.

Under [ADR-0470](../../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), a checkout whose event writer is older than schema 4 is never skipped silently. The host resident runs the local-only writer activation (backup, then the exact plan) and starts the resident. When activation is blocked, it holds the checkout: an `attention` heartbeat with reason `event_schema_outdated`, retried every 30 minutes. A Node's resident child holds the same way and resumes when `lervo upgrade` activates the writer. The host resident records every checkout's state in `knowledge-host-resident.json` and serves only while it holds `knowledge-host-resident.lock`. `lervo upgrade` installs and keeps current its service (`com.lervo.knowledge.host` or `lervo-knowledge-host.service`).

## One renewal writer

[ADR-0478](../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md) lets exactly one host write each renewal. The writer is the host the ownership fence grants commits: the Hub lease holder, the standalone owner, or a host without owner-host configuration. Every other host is a follower:

| Writer role        | When                                              | What it does with a due delegation                                                      |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `owner`            | The fence grants commits                          | Rebinds or renews under the host policy                                                 |
| `follower`         | Another host owns; `HEAD` does not track the file | Adopts a fresh owner record's expiry at the identical scope (`adopted`, source `owner`) |
| `replica_follower` | Another host owns; `HEAD` tracks the file         | Writes nothing; the repository replica carries the owner's exact bytes                  |

Renewal bytes depend only on the previous delegation and the policy. The new expiry is `previous + k × termDays` for the smallest `k ≥ 1` whose own renewal window has not opened, capped at the horizon. `review.reviewedAt` keeps the last owner review.

Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), renewal never waits for the owner:

- A delegation whose providers or ceilings exceed the policy limits renews narrowed to them: it keeps the allowed providers it already had and the lower of each ceiling. Nothing else changes. A follower adopts the owner's term when the owner's scope equals its own scope narrowed the same way. Only a delegation that shares no provider with the limits stays `outside_policy`.
- Before deciding, every reconciliation rolls an active policy's horizon forward once it falls within one renewal term plus the attention lead. The rolled policy keeps the limits, template, renewal, seeding, and authority, with `issuedAt` set to now and a horizon 365 days later. The write compares the policy hash, so a lost race keeps the current policy. A revoked policy is never rolled. A follower whose renewal is due reconciles again after 15 minutes. A host whose delegation lapsed stays eligible for the Hub lease while its policy would renew it, so a takeover never deadlocks.

Renewals are never committed or published. To make a tracked delegation host-local, remove it from the index through ordinary review.

## Delegation-bound definitions

[ADR-0477](../../../../decisions/coordination/sync/0477-carry-delegation-bound-definitions-across-hosts.md) lets a host seed a peer scope whose suites, repository roles, or asset manifest exist only on another host.

| Kind                         | Installed path                                                         | Accepted when                                                                |
| ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `verification_suite`         | `.lervo/verifications/<suiteId>.yaml`                                  | The suite passes its contract, names the bound ID, and hashes to `suiteHash` |
| `repository_role`            | `.lervo/roles/<roleId>.json` for the role and its repository ancestors | The registry with these sources resolves every accepted binding exactly      |
| `asset_disposition_manifest` | `.lervo/knowledge/convergence-asset-dispositions.json`                 | The bytes hash to `assetDispositionManifestHash`                             |

Exchange runs through the Hub's `knowledge-convergence-definitions` routes, with the host record's credential and project scope. Every host with an active delegation publishes the bound definitions it reproduces, at most once a day per content hash. A seeding host lists candidates by binding hash and reads them by content hash.

Installation writes one durable knowledge transaction. It creates absent files and replaces only files listed, with their current bytes, in `.lervo/state/knowledge/convergence-installed-definitions.json`. Any other existing file is user-owned: the seed fails with `convergence_seed_definition_conflict` and the file stays unchanged. To accept the shared definition, delete or rename your file; the next reconciliation installs it. A missing shared suite or manifest fails with `convergence_seed_definition_unavailable`.

Installed files are not committed. Commit a suite through ordinary review when every clone should run it.

## Owner-host derivation

| Current configuration                                  | Origin         | Action                                                                                                  |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------- |
| Absent                                                 | Lervo          | Write one: Hub mode with the first proven candidate, else the first unproven candidate, else standalone |
| `standalone`, label `local`, no publication, no marker | Legacy default | Migrate in place, keeping `hostId`                                                                      |
| Hash equals the derivation marker                      | Lervo          | Follow changed coordinates; enable and revalidate publication                                           |
| Anything else                                          | Operator       | Never changed                                                                                           |

Candidates come from the owning Node's `hub` configuration for a Node resident. A CLI resident uses, at most four in this order: the Node registered for the checkout in `node-fleet.json`; the Hub block of `nodes/<projectId>/config.json`; this project's `nodes/<projectId>/secrets/hub-sync.token` paired with each Hub other Hub-mode checkouts on the host use; then those checkouts' coordinates as written. Coordinates as written carry another project's token, so they are `foreign`: usable only once a probe proves them for this project, and never written unproven ([ADR-0656](../../../../decisions/coordination/sync/knowledge-ownership/0656-maintain-a-project-without-its-own-hub-credential.md)). A project without a token of its own is offered the first such Hub paired with the path where its own token belongs, `nodes/<projectId>/secrets/hub-sync.token` (`absent`). `nodes/` sits beside the user state directory, and on Linux also under `$XDG_CONFIG_HOME/lervo/nodes`. A probe is one host-record read.

Under [ADR-0471](../../../../decisions/coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md), when every candidate fails its probe, derivation writes Hub mode with the first own or `absent` candidate and marks it `unproven`; with only foreign candidates it writes nothing Hub-related, and coordinates it wrote unproven earlier are replaced. The lease then reports `unverifiable`, the host stays read-only, and the state records the cause as `owner_host_hub_unusable`. Unproven coordinates are probed again at every reconciliation. A host never falls back to standalone, which owns unconditionally, while Hub coordinates exist. Standalone mode is only for hosts without any. A project whose `dataPolicy.hubSyncEnabled` is `false` considers only its own credentials (its Node, or its `nodes/<projectId>` configuration or token): without one, the host derives standalone and maintains the project locally. A standalone host that sees another host's knowledge commit yields as `contended`. Without its own credential, a project that syncs through the Hub stays read-only. It reports one `owner_host_hub_unusable` finding with detail `hub_credential_absent`, a `credentials_missing` notice that names the principal, the reload, and the token path. A failed host-record exchange through the same coordinates adds no `hub_unavailable` finding.

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

Installing or revoking the policy is an owner instruction, never a required step: the first reviewed delegation on a host adopts a policy by itself. Renewal, horizon roll-forward, seeding, and configuration derivation under an active policy ask nobody.

## Classified document scope

Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), a reviewed layout plan carries its own exact path set, so classified documents outside the delegation's roots move through the lifecycle plan without any scope grant (see [layout and routing](../../../repository-knowledge-compilation/structural-publication/policy/layout-and-routing.md#applying-a-reviewed-layout-plan)). Reconciliation no longer builds the [ADR-0540](../../../../decisions/knowledge/documents/routing/0540-account-for-every-document-a-migration-defers.md) `scopeChange` proposal and never produces a `delegation_scope_change` finding, so the 32-root limit and `normalization_root_limit` no longer matter for layout moves.

The delegation `scope-response` command and its proposal, decision, and response records are removed. The command now fails with one line that names `lervo knowledge revert <commit>` as the undo for a layout move. The state no longer writes `scopeChange` or `scopeResponse`. A reader drops both fields and any stored `delegation_scope_change` finding.

## Provider admission and host service paths

[ADR-0536](../../../../decisions/execution/providers/admission/0536-admit-provider-clis-by-contract.md) removes provider tool directories from the host resident service definition and its upgrade plan. The definition retains the Node and Lervo startup directories and the renderer's fixed system directories. A missing provider is no longer a `service_tool_unresolved` blocker for that service. A repository Node's knowledge resident also stops contributing a provider directory to its Node service; its supervised managed paths retain their own configuration.

Each continuity host record may carry `providerAdmission`: the observation time, detection failure, bounded detected/admitted provider versions and executable hashes, last worker-observed provider/version, and waiting state. Reconciliation detects installed identities without model calls and reuses admission only for unchanged cached identities. The selection is the worker’s last model-call observation, stored separately from current admissibility. It can differ from the first admitted candidate and the first delegation entry. With no worker observation, selection is null. Cached-only reconciliation never writes admission state. Newly detected, unprobed identities have `admitted: false` and a null reason; they are not rejections. A background call probes an allowed identity before using it. Peers preserve the same projection. It contains no executable paths, prompts, credentials, provider output, or hostnames. Older records without this optional field remain readable. Deploy compatible Hub and host readers before publishing it across hosts.

Local inspection reads the current admission projection, so attention can report a change before the next peer publication. Findings `provider_cli_detected` and `provider_cli_admitted` are informational. `provider_cli_rejected`, `provider_detection_failed`, and `provider_not_admitted` are upkeep attention, attributed to actor `provider admission`, owned by the agent, and never require an owner decision. A rejected CLI remains visible when another allowed provider runs. Local `provider_not_admitted` findings also report host provider pauses with their observation time, age, next re-probe eligibility, and known reset. Excluded providers remain visible without being probed. [Provider pauses and probes](../events-and-status/provider-pauses-and-probes.md) defines the backoff and native recovery proof. Versions can differ between hosts; each executable must satisfy the same contract.

Local pause inspection uses an existing admission database in read-only mode. Missing and old schemas provide no pause observations without directory creation, permission changes, or schema migration. Admission read failures cannot discard provider rejection, delegation, resident, hook, replica, or other continuity findings. Missing pause observations do not prove recovery.

Integration with ADR-0535 remains on its separate branch. Its core health projection should consume the continuity admission projection and findings, preserve the `provider admission` actor, show the selected provider/version and cross-host differences, and retain rejection reasons and exposed closed tool names. This change does not claim the unavailable health projection is integrated.

## Findings

The doctor reports every finding. `lervo application attention` reports those of severity `attention` or `lervo_debt` as `knowledge_convergence_continuity` items, except lease, publication, and replica findings, which keep their own items. Under ADR-0561 no finding requires the user and no finding blocks. A `lervo_debt` item has state `lervo_debt`, the host resident as its action owner, and its age; its remediation says what Lervo does next, never an owner step. A stored `owner_decision` finding reads as `lervo_debt`. The doctor reports `lervo_debt` as its status and `summary.lervoDebt` in place of `owner_decision` and `ownerDecisions`.

| Code                                                                | Severity                                                              | Meaning                                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delegation_expiring`, `delegation_expired`                         | Lervo debt unless renewable                                           | No active policy can keep the delegation alive                                                                                                                                                        |
| `delegation_outside_policy`                                         | Lervo debt                                                            | The delegation shares no provider with the policy limits                                                                                                                                              |
| `delegation_missing`                                                | attention under a policy, Lervo debt when a peer converges, else info | No delegation on this host                                                                                                                                                                            |
| `delegation_invalid`                                                | Lervo debt                                                            | The delegation file fails its contract                                                                                                                                                                |
| `delegation_continuation_failed`                                    | attention                                                             | A renewal or seed failed with the recorded code                                                                                                                                                       |
| `policy_invalid`                                                    | Lervo debt                                                            | The policy file fails its contract                                                                                                                                                                    |
| `policy_horizon_near`                                               | attention                                                             | The resident has not rolled the horizon forward yet                                                                                                                                                   |
| `owner_host_hub_unusable`, `hub_unavailable`                        | attention                                                             | Hub coordinates exist but refused or failed, with the cause                                                                                                                                           |
| `definition_exchange_unavailable`                                   | attention                                                             | Bound definitions could not be shared, with the Hub cause                                                                                                                                             |
| `peer_delegation_expiring`                                          | attention without a peer policy, else info                            | A peer host's grant lapses within 72 hours                                                                                                                                                            |
| `continuity_unobserved`, `continuity_stale`, `resident_not_running` | attention                                                             | No resident reconciles this checkout                                                                                                                                                                  |
| `resident_cycle_failed`                                             | attention                                                             | The latest resident cycle failed, with its stable code                                                                                                                                                |
| `hook_runtime_unavailable`                                          | attention                                                             | The host runtime is unavailable; the host resident repairs it                                                                                                                                         |
| `event_schema_outdated`                                             | attention                                                             | A resident is held because the writer is older than schema 4                                                                                                                                          |
| `convergence_attention`                                             | attention                                                             | The owner's resident stopped convergence for the closed cause in its detail ([ADR-0530](../../../../decisions/knowledge/maintenance/0530-keep-background-knowledge-moving-past-divergent-targets.md)) |

Informational codes are `continuity_pending` (the host resident serves the checkout but has not reconciled yet), `delegation_revoked`, `policy_absent`, `policy_revoked`, `owner_host_standalone`, `publication_unavailable`, `peer_delegation_missing`, and `peer_unreported`.

### Resident cycle failure diagnostics

Local inspection reads the latest `.lervo/state/knowledge/resident-cycle.json`. A `failed` result adds `resident_cycle_failed` with severity `attention`. Its detail is `lastFailure.code`, or `unclassified_failure` for an older failed state without the field. The attention item names that code and points to `lervo knowledge convergence doctor --json`. It is nonblocking and requires no owner decision.

Each repository in doctor JSON includes `lastFailure: { code, detail, at } | null`. The code matches `^[a-z][a-z0-9_]{2,80}$` or becomes `unclassified_failure`. Typed Lervo failures retain at most 300 message characters on one line, with the repository root shortened to `.`. Native and provider failures have `detail: null`. `at` is the failure timestamp. A completed cycle clears the record and the finding. Old state files without `lastFailure` remain readable.

The owner-only state remains atomic, mode `0600`, and bounded to 4 KiB. It replaces the previous failure rather than retaining history. Typed detail may contain repository-relative paths. It excludes source bodies, prompts, and native or provider error text. Attention items and peer finding codes carry no diagnostic message. This adds no event type.

## Per-host rollout

1. Deploy the Hub first. Its new migration adds the host-record table, and the `sync.write` implication removes any credential grant.
2. Deploy the Node and CLI bundles to WSL and Mac with the existing recipes. On each host, remove any per-repository `lervo knowledge worker --watch` service (such as the Mac `com.lervo.mac.knowledge` job) and any hand-written host resident service, then run `lervo upgrade` in a registered repository and apply its plan. Its `host_service` stage installs the one managed host resident service, and its `event_writer` stage activates schema 4. Restart the Nodes.
3. On each host, the first resident cycle in a repository with a reviewed delegation adopts the policy. To install instead, run `lervo knowledge convergence delegation renewal-policy install` in a delegated repository, then rerun it with `--apply <policy-id>`.
4. Run `lervo knowledge convergence doctor` on each host. Every registered repository should show an active delegation, owner-host `hub` (or `operator` for lervo), and one `owner` with a `waiting_owner` peer.

The CLI and Node bundles also need a reader-first rollout for the new event type and attention kind: deploy every host before relying on cross-host records.

For ADR-0478, deploy the CLI and Node bundles to both hosts and restart both Nodes and host resident services in one window. Since [ADR-0483](../../../../decisions/coordination/sync/0483-run-replica-commands-through-one-current-runtime.md), `lervo upgrade` on each host maintains the `current` runtime pointer and the replica service, and it migrates a legacy `~/.lervo` coordinator configuration to `peer.remoteRuntimesDirectory`. A peer that still runs older capture semantics fails with `repository_replica_capture_incompatible`. Until both hosts run it, a checkout with a renewed tracked delegation reports replica divergence. Afterwards, run `lervo knowledge convergence owner status` on both hosts to confirm one `owner`, then `lervo knowledge convergence doctor`. On the follower, the delegation file should match the owner's bytes after the next replica cycle.

For ADR-0477, back up the Hub database and deploy the Hub before the hosts; its migration adds the definitions table, and an older Hub binary cannot open the migrated database. Until the Hub is upgraded, residents report `definition_exchange_unavailable (hub_definitions_unsupported)` and everything else keeps working. After both hosts run the new bundles, the delegated host shares its definitions on its next reconciliation. On the host that lacked them, run `lervo knowledge convergence delegation seed`, then `lervo knowledge convergence doctor`: the repository should show an active delegation and a `waiting_owner` role.

[ADR-0539](../../../../decisions/execution/providers/hooks/0539-keep-the-terminal-hook-runtime-host-local-behind-a-tracked-launcher.md) makes hook runtime repair a host-resident responsibility. Each host scan repairs missing or invalid pointer state, unavailable or repair markers, interrupted publication, or a removed publisher entry. It rechecks authority under the host lock and preserves a valid runtime published by another installed CLI. Markers trigger artifact verification on the default path before repair. A successful verification clears the marker. Attention attributes this finding to `host resident` and keeps `requiresUserAction` false. Persistent write or integrity failures retain attention and retry; the remediation names host-store access instead of asking the owner to refresh tracked runtime bytes.
