# ADR-0477: Carry delegation-bound definitions across hosts

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0469](0469-keep-background-knowledge-continuous-on-every-host.md) (seeding from a peer)
Related: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), [ADR-0473](../../knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)

## Context

A convergence delegation binds local definitions only by hash. It names each verification suite as `suiteId` plus `suiteHash`, each worker role as a role contract hash, and an optional asset disposition manifest as `assetDispositionManifestHash`. ADR-0469 seeds a missing delegation from a peer's scope, but only when this checkout already reproduces every one of those hashes.

The installed fleet showed the gap on 2026-10-06. In repository axli, the WSL delegation binds suite `repository.knowledge`. Lervo created `.lervo/verifications/repository.knowledge.yaml` on the WSL checkout, and the file was never committed. The Mac checkout is on another branch and has no `.lervo/verifications/` directory. Its resident therefore reported `delegation_missing (verification_layout_invalid)` on every cycle. The Mac could never take over if WSL stopped, which breaks the owner's rule that repository knowledge maintenance keeps working on Mac or WSL. The same failure applies to any repository whose bound suite, repository role, or asset manifest exists on only one host.

## Decision

### Hosts share the exact definitions their delegation binds

A **delegation-bound definition** is the exact local content behind one binding hash. Version 1 has three kinds:

| Kind                         | Content                                                          | Binding hash it must reproduce |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `verification_suite`         | The parsed suite                                                 | `verificationSuiteHash(suite)` |
| `repository_role`            | The bound role's repository source plus its repository ancestors | The role contract hash         |
| `asset_disposition_manifest` | The exact manifest text                                          | `sha256` of the manifest bytes |

Built-in roles ship with Lervo and are never shared. A host whose Lervo version resolves a built-in role differently still reports `convergence_seed_role_mismatch`.

Each record also carries `projectId`, `repositoryIdentityHash`, `contentHash` (`sha256` of the canonical content), `publishedAt`, and the publishing `sourceHostHash`. Canonical JSON is at most 256 KiB, so a larger manifest cannot travel.

### The Hub stores them content-addressed

The Hub that holds the ADR-0466 lease and the ADR-0469 host records serves the definitions of one repository identity:

- `POST /v1/sync/projects/{projectId}/knowledge-convergence-definitions` stores one definition. It answers `201 created` for a new content hash and `200 refreshed` for a known one. The first stored bytes of a content hash are kept; a refresh changes only the refresh time.
- `GET` on the same path lists summaries (`kind`, `bindingHash`, `contentHash`, `publishedAt`), newest refresh first.
- `GET .../knowledge-convergence-definitions/{contentHash}` returns `{ "definition": ... }`, or `{ "definition": null }` when the hash is unknown. Only `GET` is allowed on this path.

Both routes take the usual `destinationId` and `projectIdentityHash` query. They are knowledge coordination routes, so `sync.write` satisfies them as ADR-0469 defines, and the project scope check is unchanged. The Hub refuses a definition whose content does not reproduce its content hash. It also refuses a suite or manifest whose content does not reproduce its binding hash. The Hub cannot recompute a role contract, so the importing host verifies roles. The Hub keeps at most 64 definitions per repository identity and prunes the least recently refreshed first.

### Every delegated host publishes what it reproduces

After each reconciliation, a host with an active, unexpired delegation publishes every bound definition its checkout reproduces exactly. A binding the checkout does not reproduce is skipped, so unreviewed content never leaves the host. A definition the Hub refreshed within the last 24 hours is not sent again. Publication failures never block the cycle.

### A seeding host installs only content that reproduces its binding

Before a host seeds from a peer scope, it applies the scope contract and checks the repository identity. It then lists the bindings this checkout does not reproduce and fetches candidates for each one by binding hash. A candidate is accepted only when it reproduces the reviewed binding:

- A suite must pass the suite contract, name the bound `suiteId`, and hash to `suiteHash`.
- A manifest's bytes must hash to `assetDispositionManifestHash`.
- Repository role sources are added to the role registry in memory, and every accepted binding must resolve to its exact version, contract hash, and profile hash.

Installing never runs a command. Suites run later only through the ordinary verification path, which checks the same hash again.

Accepted content lands at its ordinary path: `.lervo/verifications/<suiteId>.yaml`, `.lervo/roles/<roleId>.json`, or `.lervo/knowledge/convergence-asset-dispositions.json`. An installed suite starts with a comment that names ADR-0477 and its binding. All files land in one durable knowledge transaction. A write may create an absent file or replace a **Lervo-managed** file. A Lervo-managed file is one whose current bytes still match an entry in the host-local install ledger. Identical bytes need no write. Any other existing file is user-owned, and the installation stops with `convergence_seed_definition_conflict` before it writes anything. Seeding then continues on the ordinary path, and the delegation plan revalidates every suite and role.

A missing suite or manifest stops seeding with `convergence_seed_definition_unavailable`. A role that nobody shared is left to the ordinary role check, which reports `convergence_seed_role_mismatch`.

### Installed definitions stay host-local; committing them stays an owner decision

Lervo does not commit installed definitions, and knowledge publication does not carry them. Three reasons decide this:

1. The Hub copy already converges every host without touching any branch, and it survives the source host going down.
2. Suites and roles lie outside the ADR-0473 knowledge write scope. A suite holds commands every clone would run, so adding it to the shared remote is a consequential repository write that needs owner review.
3. On the source host, the same file is usually untracked. A published commit that adds it would make that host's next merge abort with "untracked working tree files would be overwritten", which disturbs the owner's branch.

The installed suite's header asks the owner to commit it through review. Once a reviewed commit carries the same bytes, nothing else changes: the file was already in place.

### Compatibility and deploy order

The record, the routes, and the table are additive. A Hub without them answers the definitions routes with `404`. A resident then records `definition_exchange_unavailable` with detail `hub_definitions_unsupported`, and host records and the lease keep working. Seeding a checkout that already reproduces every binding is unchanged.

Deploy in this order:

1. Back up the Hub database, then deploy the Hub. Its migration adds the `hub_knowledge_convergence_definitions` table. A Hub binary older than this migration refuses to open the migrated database, so a Hub rollback restores the backup.
2. Deploy the CLI and Node bundles on every host. Readers of the new event must deploy before writers, as for every schema-4 event.
3. Restart the Nodes and the host resident service. The source host publishes on its next reconciliation, and a missing host installs and seeds on its next one, or at once with `lervo knowledge convergence delegation seed`.

## Events, state, and failure meaning

`knowledge.convergence.definitions.installed` (event schema 4) records one installation:

- Required fields: `repositoryIdentityHash`, `scopeHash` (the seeded peer scope), `observerHostHash` or null, `sourceHostHash` or null, `definitions` (1 to 32 entries of `kind`, `bindingHash`, `contentHash`, and `action`: `created | replaced`), `occurredAt`.
- Privacy: hashes and closed codes only. Suite IDs, role IDs, paths, commands, and content stay out.
- The event ID derives from `scopeHash` and the entries, so a retried append is deduplicated. The installed files and their materialization receipt (operation `convergence_delegation_definitions`) are canonical. An append failure loses only the audit line.

Host-local state: `.lervo/state/knowledge/convergence-installed-definitions.json` lists the path, the `sha256` of the installed bytes, and the install time for at most 128 installs, newest first. It is mode `0600`, never replicates, and is written before the transaction. A crash therefore leaves at most an entry no file matches. An unreadable ledger proves no ownership, so every existing file stays user-owned.

Hub state: `hub_knowledge_convergence_definitions`, keyed by destination, project, repository identity, and content hash, with the kind, binding hash, definition JSON, first publication time, and last refresh time.

Failure codes:

- `convergence_seed_definition_unavailable`: no shared candidate reproduces a bound suite or manifest.
- `convergence_seed_definition_conflict`: a user-owned file occupies a path where the scope binds different content.
- `hub_definitions_unsupported`: the Hub answered a definitions route with `404`.

Continuity reports a failed seed as `delegation_missing` with the code as detail, under the ADR-0469 severities. A failed exchange adds the `attention` finding `definition_exchange_unavailable` with the Hub cause as detail, unless the host records already failed (`hub_unavailable`). Failed steps retry at the next reconciliation.

## Consequences

- A host that lacks a bound suite or repository role seeds once any delegated host has shared it, and then waits for the lease holder. Takeover no longer depends on a file existing on one host.
- Seeding never accepts content that differs from the reviewed binding, and it never overwrites a user-owned file.
- Definitions can stay untracked in Git and still reach every host. The owner commits them when they want every clone to run them.

## Deferred

- A delegated host whose managed copy falls behind a peer's newly reviewed suite keeps its own binding. Following a peer's rebound scope automatically needs a scope-change rule beyond identity-preserving rebind.
- Capability packages are not shared. A capability hash that differs between hosts still reports `convergence_seed_role_mismatch`.
- An asset manifest over 256 KiB cannot travel through the Hub.

## Verification

Focused tests show:

- Contract validation accepts a suite or manifest only when its content reproduces the binding, and bounds the size.
- The SQLite store keeps the first bytes per content hash, refreshes on republish, and prunes the least recently refreshed definition beyond 64.
- Over HTTP, a `sync.write` Node publishes, lists, and reads definitions. A forged binding is refused, `POST` on the hash path answers `405`, another project's credential gets `403`, and an older Hub's `404` stays visible.
- Two simulated hosts: the peer lacks the untracked suite, installs it as a Lervo-managed file with one event and a ledger entry, seeds an active delegation at the same scope hash, and observes `waiting_owner` while the other host owns.
- A different user-owned suite is reported as `convergence_seed_definition_conflict` and kept byte-for-byte. Forged content is reported as `convergence_seed_definition_unavailable` and writes nothing. An older Hub yields `definition_exchange_unavailable` while host records keep working.
- A repository role installs only when its contract reproduces the binding. A managed suite is replaced when the binding changes. An edited managed suite becomes user-owned and stops the installation.
