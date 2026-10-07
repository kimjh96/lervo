# Tool-generated opaque files and role resolution

[ADR-0491](../../decisions/knowledge/semantics/0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md) amends ADR-0473 tool ownership and ADR-0479 asset settlement.

## Package-manager ownership

Package-manager ownership is `generator_configuration` evidence with `generator: "package_manager"`. A lockfile must have an adjacent `package.json`. That package declares its manager through `packageManager`, or inherits the nearest ancestor package's declaration when its own is absent. Only the declared manager's outputs qualify:

| Manager | Lockfiles |
| --- | --- |
| npm | `package-lock.json`, `npm-shrinkwrap.json` |
| pnpm | `pnpm-lock.yaml` |
| yarn | `yarn.lock` |
| bun | `bun.lock`, `bun.lockb` |

A filename alone, another manager's lockfile, or a lockfile without an adjacent package manifest proves no ownership. Evidence records only the manager name and declaring package path.

## Asset settlement and cleanup

At final verification, opaque sources with any ADR-0473 tool-ownership evidence count as `assetSettlement.toolGenerated`. They need no asset declaration, and declarations do not bind them. This grants neither semantic nor visual approval. Other opaque sources retain their applicable typed declaration or exact captured-revision suite-binding requirements. Pinned verification is never bypassed.

The same-scope rebind removes tool-generated declarations from both inline `assetDispositions` and the asset manifest. Ordinary plan/apply updates `assetDispositionManifestHash`. Every other declaration retains its exact content and order; every scope coordinate remains unchanged.

A working-tree manifest differing from its committed version only by these removals is settled Lervo output. The next batch-boundary commit records it so integration workspaces and repository verification read the cleaned manifest. Changes to non-tool-generated declarations do not qualify. Existing materialization and `knowledge.convergence.delegation.continued` (`rebound`) events record the cleanup.

Shiflo's failed asset-integrity suite remains valid failure evidence. Pinning its declared Bun manager's lockfiles was the Lervo design gap; manual lockfile repinning is not current acceptance. Acceptance requires automatic owner-host rebind, then passing pinned verification and departure from `knowledge_verification_failed`. No supplied evidence establishes that recovery.

## Role resolution

Role resolution is memoized by the canonical digest of exact repository role sources, with at most 16 registries and private clones for every caller. Built-in identity checks use a precomputed set. Changed sources force resolution under a new digest. Tests must establish independent clones and invalidation.

The source reports a local resolution reduction from about 2.1 ms to 0.47 ms. Its WSL profile observed 12.8 seconds in role resolution within 43.5 seconds of main-thread busy time during a 120-second profile. A lower installed CPU share remains an acceptance requirement, not a measured outcome in the supplied evidence.
