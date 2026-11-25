# ADR-0438: Bind bounded asset manifests to delegation

Status: `accepted`
Decision date: 2026-09-28
Amended by: [ADR-0479](../../semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md) (undeclared opaque assets are suite-bound at final verification)
Amended by: [ADR-0448](0448-settle-unread-sensitive-sources-by-disposition.md)

## Context

Digimon's complete source inventory contains 277 opaque assets, exceeding the 256-item inline disposition limit and 64 KiB reviewed delegation bound. Omitting captured assets or treating integrity checks as visual approval would falsely establish baseline currency.

## Decision

An exact reviewed version-one delegation may include `assetDispositionManifestHash`, the SHA-256 digest of the complete raw UTF-8 bytes at `.lervo/knowledge/convergence-asset-dispositions.json`. This fixed, owner-controlled sidecar contains exactly `schemaVersion: 1` and `dispositions`. Each disposition requires `path`, `contentHash`, `kind`, `verificationSuiteId`, and `rationale`. Paths must be unique, safe repository coordinates outside Git and private Lervo metadata. Kinds remain `opaque_verified` or `sensitive_local`; suite IDs must belong to the delegation's exact pinned meaningful verification suites.

The sidecar is limited to 1 MiB; inline and sidecar declarations together are limited to 1,024 unique items. The 256-item inline and 64 KiB delegation bounds remain unchanged. Growth replaces this one current file; canonical Git and materialization events retain historical coordinates. No per-asset authority file, event, or writer version is introduced.

The optional CLI argument `--asset-manifest-from <reviewed-assets.json>` supplies exact already-reviewed candidate bytes. Preview validates without writing either file. The existing delegation plan binds the desired sidecar bytes and both files' exact preimages. Apply rechecks the entire plan, ancestry, roles, capabilities, suites, and project, then writes both files through one existing durable journal. A stale plan changes neither file. Failure before the canonical materialization event rolls both files back or retains explicit recovery uncertainty. A matching existing sidecar may be bound without replacement.

The existing delegation review hash binds the optional manifest hash. Runtime authorization and synchronous outcome settlement reread ordinary no-follow sidecar bytes and verify the exact digest. Candidates cannot create their own authority. Changing, deleting, linking, or invalidating the sidecar stops execution and settlement. Revocation and expiry retain their existing meaning.

A disposition binds exact source bytes to repository verification responsibility. It establishes no text semantic coverage, experimental-to-approved promotion, visual quality, or independent document review. Final lifecycle verification must run every pinned suite and satisfy the complete asset, canonical, normalization, and projection contracts. Capture remains complete under ADR-0436. This decision grants no additional provider calls, write paths, source ceiling, or tools.

## State, privacy, and failure meaning

The optional delegation field and fixed sidecar are canonical owner-controlled authority inputs. Full paths, rationale, candidate bodies, and receipts remain local or in private CAS. The existing `knowledge.materialization.applied` event exposes bounded plan/hash coordinates and created/updated counts, without asset paths or rationale. No new public state or event is introduced.

- `knowledge_authority_unavailable`: missing or changed bytes, unsupported schema, malformed encoding, unsafe or duplicate paths, unpinned suites, unreviewed hashes, linked authority inputs, or exceeded declaration bounds.
- `knowledge_plan_stale`: either exact authority preimage changed after preview; no overwrite is authorized.
- `asset_verification_required`: a current captured asset lacks a matching exact path/hash/kind disposition. Declarations for old bytes cannot cover changed source.
- Existing materialization rollback and `recovery_required` retain uncertain-effect ownership. File presence alone cannot establish apply.

## Verification

Focused regressions cover 277 complete captured opaque assets, unchanged grant bounds, effect-free preview, one atomic materialization receipt, missing and changed manifests, unsafe paths, suite mismatch, malformed UTF-8, count and byte limits, combined duplicates, concurrent replacement, two-file rollback, source drift, and synchronous settlement drift. CLI tests cover the same exact preview/apply boundary.

Compatible installed readers must precede activation of a manifest-bound project delegation. Installed complete asset and lifecycle acceptance remains an independent roadmap gate.

## References

- [ADR-0436](0436-reviewed-source-capture-and-bounded-canonical-worksets.md)
- [Background convergence runtime](../../../../specs/background-knowledge-convergence/runtime.md)
- [Authority, assessment, and integration](../../../../specs/background-knowledge-convergence/authority-and-completion/authority-and-integration.md)
- [Autonomous background convergence](../../../../roadmap/knowledge/autonomous-background-convergence.md)
