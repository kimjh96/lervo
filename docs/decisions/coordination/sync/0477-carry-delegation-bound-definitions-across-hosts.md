# ADR-0477: Carry delegation-bound definitions across hosts

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0469](0469-keep-background-knowledge-continuous-on-every-host.md) (seeding from a peer)
Related: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), [ADR-0473](../../knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)

## Context

A convergence delegation binds verification suites by `suiteId` and `suiteHash`, worker roles by role contract hash, and an optional asset disposition manifest by `assetDispositionManifestHash`. ADR-0469 seeds a missing delegation from a peer scope only if the local checkout already reproduces every binding hash.

On 2026-10-06, repository axli exposed the gap: its WSL delegation binds `repository.knowledge`, but Lervo's `.lervo/verifications/repository.knowledge.yaml` was never committed. The Mac checkout, on another branch with no `.lervo/verifications/` directory, reported `delegation_missing (verification_layout_invalid)` every cycle. It could not take over if WSL stopped, violating the owner's requirement that repository knowledge maintenance keep working on Mac or WSL. Any suite, repository role, or asset manifest present on only one host creates the same failure.

## Decision

### Share exact delegation-bound definitions

A **delegation-bound definition** is the exact local content behind one binding hash. Version 1 supports:

| Kind | Content | Required binding hash |
| --- | --- | --- |
| `verification_suite` | Parsed suite | `verificationSuiteHash(suite)` |
| `repository_role` | Bound role's repository source and repository ancestors | Role contract hash |
| `asset_disposition_manifest` | Exact manifest text | `sha256` of manifest bytes |

Built-in roles ship with Lervo and are never shared. A Lervo version that resolves a built-in role differently still reports `convergence_seed_role_mismatch`.

Each record also carries `projectId`, `repositoryIdentityHash`, `contentHash` (`sha256` of canonical content), `publishedAt`, and publishing `sourceHostHash`. Canonical JSON is limited to 256 KiB; larger manifests cannot travel.

### Store definitions content-addressed in the Hub

The Hub holding the ADR-0466 lease and ADR-0469 host records serves definitions for one repository identity:

- `POST /v1/sync/projects/{projectId}/knowledge-convergence-definitions` stores one definition: `201 created` for a new content hash, `200 refreshed` for a known hash. The first stored bytes are retained; refresh changes only the refresh time.
- `GET` on that path lists summaries (`kind`, `bindingHash`, `contentHash`, `publishedAt`), newest refresh first.
- `GET .../knowledge-convergence-definitions/{contentHash}` returns `{ "definition": ... }`, or `{ "definition": null }` for an unknown hash. This path allows only `GET`.

Both routes take the usual `destinationId` and `projectIdentityHash` query. They are knowledge coordination routes: `sync.write` satisfies them under ADR-0469, with the project scope check unchanged.

The Hub rejects content that fails to reproduce its content hash, and suites or manifests that fail to reproduce their binding hash. It cannot recompute role contracts; importing hosts verify roles. It retains at most 64 definitions per repository identity, pruning the least recently refreshed first.

### Publish reproduced definitions after reconciliation

After each reconciliation, every host with an active, unexpired delegation publishes every bound definition its checkout reproduces exactly. It skips bindings it cannot reproduce, so unreviewed content never leaves the host. Definitions refreshed by the Hub within the last 24 hours are not resent. Publication failures never block the cycle.

### Install only definitions that reproduce the seed binding

Before seeding from a peer scope, a host applies the scope contract and checks repository identity. It lists bindings the checkout cannot reproduce and fetches candidates for each by binding hash. Acceptance requires:

- Suites pass the suite contract, name the bound `suiteId`, and hash to `suiteHash`.
- Manifest bytes hash to `assetDispositionManifestHash`.
- Repository role sources enter the role registry in memory; every accepted binding resolves to its exact version, contract hash, and profile hash.

Installation never runs commands. Suites run later through the ordinary verification path, which checks the same hash again.

Accepted content uses its ordinary path:

- `.lervo/verifications/<suiteId>.yaml`
- `.lervo/roles/<roleId>.json`
- `.lervo/knowledge/convergence-asset-dispositions.json`

An installed suite starts with a comment naming ADR-0477 and its binding. All files land in one durable knowledge transaction. Writes may create absent files or replace **Lervo-managed** files: files whose current bytes still match an entry in the host-local install ledger. Identical bytes require no write. Any other existing file is user-owned; installation stops with `convergence_seed_definition_conflict` before writing anything. After installation, seeding follows the ordinary path, and the delegation plan revalidates every suite and role.

A missing suite or manifest stops seeding with `convergence_seed_definition_unavailable`. An unshared role remains subject to the ordinary role check, which reports `convergence_seed_role_mismatch`.

### Keep installed definitions host-local; owners decide whether to commit

Lervo does not commit installed definitions, and knowledge publication does not carry them:

1. The Hub copy converges every host without touching branches and survives source-host downtime.
2. Suites and roles are outside the ADR-0473 knowledge write scope. Suites contain commands every clone would run; adding one to the shared remote is a consequential repository write requiring owner review.
3. The source-host file is usually untracked. Publishing a commit that adds it would abort that host's next merge with "untracked working tree files would be overwritten", disturbing the owner's branch.

The installed suite header asks the owner to commit it through review. A reviewed commit carrying identical bytes changes nothing else: the file is already present.

### Compatibility and deployment

The record, routes, and table are additive. A Hub without them returns `404` on definitions routes. The resident records `definition_exchange_unavailable` with detail `hub_definitions_unsupported`; host records and the lease continue working. Seeding a checkout that already reproduces every binding is unchanged.

Deploy in order:

1. Back up the Hub database, then deploy the Hub. Its migration adds `hub_knowledge_convergence_definitions`. Older Hub binaries refuse to open the migrated database; rollback requires restoring the backup.
2. Deploy CLI and Node bundles on every host. Readers of the new event must precede writers, as for every schema-4 event.
3. Restart Nodes and the host resident service. The source host publishes on its next reconciliation. A missing host installs and seeds on its next reconciliation, or immediately with `lervo knowledge convergence delegation seed`.

## Events, state, and failure meaning

`knowledge.convergence.definitions.installed` (event schema 4) records one installation:

- Required fields: `repositoryIdentityHash`, `scopeHash` (seeded peer scope), `observerHostHash` or null, `sourceHostHash` or null, `definitions` (1–32 entries containing `kind`, `bindingHash`, `contentHash`, and `action`: `created | replaced`), and `occurredAt`.
- Privacy: hashes and closed codes only; exclude suite IDs, role IDs, paths, commands, and content.
- The event ID derives from `scopeHash` and the entries, deduplicating retried appends. Installed files and their materialization receipt (operation `convergence_delegation_definitions`) are canonical. Append failure loses only the audit line.

The host-local ledger, `.lervo/state/knowledge/convergence-installed-definitions.json`, records path, installed-byte `sha256`, and install time for at most 128 installs, newest first. It has mode `0600`, never replicates, and is written before the transaction. A crash therefore leaves at most an entry matching no file. An unreadable ledger proves no ownership: every existing file remains user-owned.

Hub state is `hub_knowledge_convergence_definitions`, keyed by destination, project, repository identity, and content hash. It stores kind, binding hash, definition JSON, first publication time, and last refresh time.

| Failure code | Meaning |
| --- | --- |
| `convergence_seed_definition_unavailable` | No shared candidate reproduces a bound suite or manifest. |
| `convergence_seed_definition_conflict` | A user-owned file occupies a path where the scope binds different content. |
| `hub_definitions_unsupported` | A definitions route returned `404`. |

Continuity reports failed seeds as `delegation_missing`, with the failure code as detail, under ADR-0469 severities. A failed exchange adds the `attention` finding `definition_exchange_unavailable` with the Hub cause as detail, unless host records already failed (`hub_unavailable`). Failed steps retry at the next reconciliation.

## Consequences

- A host missing a bound suite or repository role can seed once any delegated host shares it, then waits for the lease holder. Takeover no longer depends on a file present on only one host.
- Seeding accepts only content matching the reviewed binding and never overwrites user-owned files.
- Definitions can remain untracked in Git while reaching every host. Owners commit them when they want every clone to run them.

## Deferred

- A delegated host whose managed copy trails a peer's newly reviewed suite retains its own binding. Automatically following a peer's rebound scope requires a scope-change rule beyond identity-preserving rebind.
- Capability packages are not shared. Differing capability hashes across hosts still produce `convergence_seed_role_mismatch`.
- Asset manifests over 256 KiB cannot travel through the Hub.

## Verification

Focused tests show:

- Contract validation accepts suites and manifests only when content reproduces the binding, and bounds size.
- SQLite preserves the first bytes per content hash, refreshes on republish, and prunes the least recently refreshed definition beyond 64.
- Over HTTP, a `sync.write` Node publishes, lists, and reads definitions. Forged bindings are refused; `POST` on the hash path returns `405`; another project's credential gets `403`; an older Hub's `404` remains visible.
- With two simulated hosts, the peer missing the untracked suite installs it as Lervo-managed with one event and a ledger entry, seeds an active delegation at the same scope hash, and observes `waiting_owner` while the other host owns.
- A different user-owned suite yields `convergence_seed_definition_conflict` and remains byte-for-byte intact. Forged content yields `convergence_seed_definition_unavailable` and writes nothing. An older Hub yields `definition_exchange_unavailable` while host records keep working.
- Repository roles install only when their contract reproduces the binding. A changed binding replaces a managed suite; an edited managed suite becomes user-owned and stops installation.
