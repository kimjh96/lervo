# ADR-0491: Never pin tool-generated files as assets, and memoize the role registry

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0473](../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) and [ADR-0479](0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md)

## Context

On 2026-10-07, `shiflo` stopped at `canonical_integration` with `knowledge_verification_failed`. Its pinned suite, `repository.asset-integrity`, runs `tools/assets/verify-canonical-assets.mjs`, which reads Lervo's asset manifest, `.lervo/knowledge/convergence-asset-dispositions.json`. The manifest pinned `bun.lock` and `apps/app/bun.lock` at fixed hashes. The repository's `package.json` declares `packageManager: "bun@1.3.3"`. A routine dependency update (PR #51) rewrote `bun.lock`, causing `Asset hash changed: bun.lock`. This is a Lervo design gap, not an owner error: pinning a tool-generated lockfile as a canonical opaque asset breaks verification on every dependency change.

A 120-second V8 CPU profile of the lervo Node main thread on the WSL host showed 43.5 s busy, including 12.8 s in `resolveRoleContracts`. Each call rebuilt, validated, hashed, and cloned every built-in role definition and repository role composition. Every assignment and agent read resolves the full registry, so assignment sweeps repeated this work once per record. Other work included 3.7 s of garbage collection and 2.6 s of event reads, spread across smaller callers.

## Decision

### Tool-generated files are not canonical assets

Extend ADR-0473's tool-ownership evidence with `generator_configuration` using `generator: "package_manager"`. A `package.json` declares its manager through `packageManager`; if absent, use the nearest ancestor `package.json` with a declaration, as for a workspace root. The declared manager is the evidence for its documented lockfile outputs beside the local `package.json`:

- npm: `package-lock.json`, `npm-shrinkwrap.json`.
- pnpm: `pnpm-lock.yaml`.
- yarn: `yarn.lock`.
- bun: `bun.lock`, `bun.lockb`.

A lockfile without a `package.json` beside it, or one produced by another manager, proves nothing.

At final verification, opaque baseline sources with any ADR-0473 evidence count as `toolGenerated` in `assetSettlement`. They need no declaration, and no declaration binds them.

The ADR-0470 same-scope rebind removes tool-generated path declarations from inline `assetDispositions` and the manifest. Through the ordinary plan/apply journal, it rebinds `assetDispositionManifestHash` to the new manifest bytes. Every other declaration retains its exact content and order, and every scope coordinate remains unchanged.

A working-tree manifest differing from the committed manifest only by these removals is a settled Lervo output. The next batch-boundary commit records it so isolated integration workspaces and the repository's script see the cleaned manifest.

### Role registry memoization

Role registry resolution is a pure function of the exact repository role sources. Memoize the resolved registry by the canonical digest of those sources, retaining at most 16 registries. Every caller receives private clones. Built-in role identity checks use a precomputed set. A changed role source produces a new digest and is resolved again.

## State, events, privacy, and failure meaning

No event, state, or failure code is added. `assetSettlement` gains the count `toolGenerated`. Tool-ownership evidence gains the closed `package_manager` generator, recording only the manager name and declaring `package.json` path. Manifest cleanup uses the existing `knowledge.convergence.delegation.continued` event (`rebound`) and materialization event.

## Verification

Focused tests must show:

- Root and workspace bun lockfiles are attributed to the declared manager; another manager's lockfile and a lockfile without a `package.json` are not.
- The rebind drops a pinned `bun.lock`, preserves every other declaration and scope coordinate, and lets the cleaned manifest settle as Lervo output. A second rebind finds nothing to drop.
- A manifest edit changing or removing a non-tool-generated declaration never settles.
- A changed tool-generated opaque file settles as `toolGenerated` without a declaration.
- The role memo resolves an unchanged registry once, returns independent clones, and resolves again when a role source changes. Locally, one registry resolution fell from about 2.1 ms to about 0.47 ms.

Installed verification must show `shiflo` leaving `knowledge_verification_failed` after its owner host rebinds, without an owner command. It must also show a lower lervo Node CPU profile share for role resolution.
