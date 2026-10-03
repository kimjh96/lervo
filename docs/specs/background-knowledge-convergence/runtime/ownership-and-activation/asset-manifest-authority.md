# Asset manifest authority

[ADR-0438](../../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) permits optional `assetDispositionManifestHash` binding the exact raw UTF-8 bytes of the fixed `.lervo/knowledge/convergence-asset-dispositions.json` sidecar. Its closed version-one contract contains `schemaVersion` and `dispositions`, with the same per-asset fields and suite pins as inline declarations.

The sidecar is at most 1 MiB. Inline and sidecar declarations together contain at most 1,024 unique safe paths; inline declarations remain limited to 256 and delegation to 64 KiB. Runtime authority and synchronous settlement recheck ordinary no-follow bytes. A sidecar alone grants neither permission nor semantic acceptance.

## Commands and application

```bash
lervo knowledge convergence status --json
lervo knowledge convergence inspect --json
lervo knowledge convergence delegation --from reviewed-delegation.json --json
lervo knowledge convergence delegation --from reviewed-delegation.json --apply <exact-plan-id> --json
lervo knowledge convergence delegation --from reviewed-delegation.json --asset-manifest-from reviewed-assets.json --json
lervo knowledge convergence delegation --from reviewed-delegation.json --asset-manifest-from reviewed-assets.json --apply <exact-plan-id> --json
lervo knowledge worker --watch --provider codex
lervo knowledge worker --once --provider codex
```

The delegation command previews or durably applies an already reviewed complete object; it does not author a review. Revocation uses the same exact plan/apply path with `state: revoked`. Calls and writes recheck source, authority, and scoped leases. Revocation aborts in-flight capability-free generation where supported; an unresolved materialization journal remains an explicit recovery obligation.

A supplied reviewed asset manifest includes its exact desired bytes and both authority preimages in the same plan. One durable journal applies both files; the existing materialization event records their counts and hashes. Concurrent replacement refuses the entire plan. Failed event recording rolls back both files or retains explicit recovery uncertainty. Asset source drift requires a new exact disposition and verification; generic byte integrity never approves visual or runtime promotion.
