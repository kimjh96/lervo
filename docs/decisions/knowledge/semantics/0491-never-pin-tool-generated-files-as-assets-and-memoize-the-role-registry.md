# ADR-0491: Never pin tool-generated files as assets, and memoize the role registry

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0473](../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) and [ADR-0479](0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md)

## Context

On 2026-10-07, `shiflo` stopped at `canonical_integration` with `knowledge_verification_failed`. Its pinned suite `repository.asset-integrity` runs the repository's script `tools/assets/verify-canonical-assets.mjs`. The script reads Lervo's asset manifest `.lervo/knowledge/convergence-asset-dispositions.json`, which pinned `bun.lock` and `apps/app/bun.lock` at fixed hashes. The repository's `package.json` declares `packageManager: "bun@1.3.3"`. A routine dependency update (PR #51) rewrote `bun.lock`, and the script failed with `Asset hash changed: bun.lock`. This is a Lervo design gap, not an owner error. A lockfile is tool output, so pinning it as a canonical opaque asset breaks verification on every dependency change.

On the WSL host, a 120-second V8 CPU profile of the lervo Node main thread showed 43.5 s busy. Of that, 12.8 s was in `resolveRoleContracts`, which rebuilt, validated, hashed, and cloned every built-in role definition and repository role composition on each call. Every assignment and agent read resolves the full registry, so an assignment sweep repeated it once per record. The rest included 3.7 s of garbage collection and 2.6 s of event reads, spread across smaller callers.

## Decision

### Tool-generated files are not canonical assets

- ADR-0473's tool-ownership evidence gains one kind: `generator_configuration` with `generator: "package_manager"`. A `package.json` declares its manager in `packageManager`. If it has no declaration, the nearest ancestor `package.json` that has one applies, as in a workspace root. The lockfiles that manager documents as its own output beside that `package.json` are tool-generated. These are `package-lock.json` and `npm-shrinkwrap.json` for npm, `pnpm-lock.yaml` for pnpm, `yarn.lock` for yarn, and `bun.lock` and `bun.lockb` for bun. The declared tool is the evidence. A lockfile without a `package.json` beside it, or one that another manager would write, proves nothing.
- At final verification, opaque baseline sources with any ADR-0473 evidence count as `toolGenerated` in `assetSettlement`. They need no declaration, and no declaration binds them.
- The ADR-0470 same-scope rebind removes declarations of tool-generated paths from inline `assetDispositions` and from the manifest. It rebinds `assetDispositionManifestHash` to the new manifest bytes through the ordinary plan/apply journal. Every other declaration keeps its exact content and order, and the rebind keeps every scope coordinate.
- A working-tree manifest that differs from the committed one only by such removals is a settled Lervo output. The next batch-boundary commit records it, so isolated integration workspaces and the repository's own script see the cleaned manifest.

### Role registry memoization

Resolving the role registry is a pure function of the exact repository role sources. The resolved registry is memoized by the canonical digest of those sources, holding at most 16 registries, and every caller receives private clones. Built-in role identity checks use a precomputed set. A changed role source produces a new digest and is resolved again.

## State, events, privacy, and failure meaning

No event, state, or failure code is added. `assetSettlement` gains `toolGenerated`, a count. Tool-ownership evidence gains the closed `package_manager` generator, which records only the manager name and the declaring `package.json` path. A manifest cleanup is recorded by the existing `knowledge.convergence.delegation.continued` event (`rebound`) and the existing materialization event.

## Verification

Focused tests must show:

- Root and workspace bun lockfiles are attributed to the declared manager, while another manager's lockfile and a lockfile without a `package.json` are not.
- The rebind drops a pinned `bun.lock` and keeps every other declaration and scope coordinate. The cleaned manifest settles as Lervo output, and a second rebind finds nothing to drop.
- A manifest edit that changes or removes a non-tool-generated declaration never settles.
- A changed tool-generated opaque file settles as `toolGenerated` without a declaration.
- The role memo resolves an unchanged registry once and hands out independent clones, and a changed role source resolves again. Locally, one registry resolution fell from about 2.1 ms to about 0.47 ms.

Installed verification must show `shiflo` leaving `knowledge_verification_failed` after its owner host rebinds, without an owner command. It must also show a lower lervo Node CPU profile share for role resolution.
