# Ownership and activation

## Runtime ownership

`@lervo/repository-knowledge` owns provider-neutral baseline replay, stage handoff, receipts, and settlement. The bundled private `@lervo/repository-knowledge-runtime` composes repository sources, workforce, managed workspaces, integration, normalization, and lifecycle verification. CLI and Node share that runtime; provider process behavior remains in `@lervo/repository-knowledge-compiler`.

The standalone Node hosts the version-four resident owner in one owned child of the same immutable runtime artifact, following [ADR-0441](../../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md). Managed conversation repository snapshots use a separate one-shot child of that artifact under [ADR-0442](../../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md), retaining the existing snapshot policy and deadline.

Under [ADR-0444](../../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md):

- A managed provider run holds a shared repository source lease from admission through settlement.
- Durable knowledge apply and recovery hold an exclusive lease around the complete journal and event effect.
- Concurrent turns may read together; a knowledge writer uses bounded retry scheduling while a turn is active.
- Busy or invalid managed admission fails the existing repository snapshot stage before provider start.
- An interrupted materialization journal blocks new managed reads until recovery.

The resident knowledge child awaits ordinary cleanup on parent shutdown. A snapshot child stops read-only capture if its parent disappears. This grants no new provider or write authority. Library hosts without a runtime entry retain existing behavior. Installed child ancestry and real busy Discord acceptance require observation independent of source tests.

When an active knowledge materialization transaction causes the knowledge index to return `knowledge_recovery_required`, a managed conversation read records and uses only its operational repository search attempt. That turn emits no knowledge attempt, knowledge recommendation, relation projection, or currency claim. Other knowledge-source failures still fail closed. This fallback neither settles nor recovers the background transaction; the owner retains that obligation.

## Delegation and activation

The runtime requires the reviewed event-writer version 4 transition and an exact project delegation. Default writers remain unchanged. Reader support must precede production activation. Without valid delegation, discovery reports `waiting_authority` and invokes no provider or document writer.

Delegation lives at `.lervo/knowledge/convergence-delegation.json`. Its version 1 contract pins:

- Project and active parent ancestry.
- Generator/reviewer/writer/integrator role versions and hashes.
- Capabilities, provider choices, canonical and normalization roots, and meaningful verification suites.
- Integration ref, repository identity, expiry, resource ceilings, and an existing reviewer's exact plan hash.

Optional asset dispositions bind exact path/hash, kind, rationale, and a pinned verification suite. Generated output cannot create these permissions.

Parent and reviewer ancestry is local to the repository host. Source replication between hosts with separate workforce records must not exchange the authority file. Project initialization ignores its exact path in `.lervo/.gitignore`; each host applies its own reviewed grant. The grant remains authoritative locally without allowing a peer's unrelated agent identity or expired grant to replace it. The asset disposition sidecar and canonical repository documents remain ordinary repository sources.

## Asset manifest authority

[ADR-0438](../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) permits optional `assetDispositionManifestHash` binding the exact raw UTF-8 bytes of the fixed `.lervo/knowledge/convergence-asset-dispositions.json` sidecar. Its closed version-one contract contains `schemaVersion` and `dispositions`, with the same per-asset fields and suite pins as inline declarations.

The sidecar is at most 1 MiB. Inline and sidecar declarations together contain at most 1,024 unique safe paths; inline declarations remain limited to 256 and delegation to 64 KiB. Runtime authority and synchronous settlement recheck ordinary no-follow bytes. A sidecar alone grants neither permission nor semantic acceptance.

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
