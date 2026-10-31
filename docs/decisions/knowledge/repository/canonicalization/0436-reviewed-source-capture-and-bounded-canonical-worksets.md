# ADR-0436: Reviewed source capture and bounded canonical worksets

Status: `accepted`
Decision date: 2026-09-28
Amended by: [ADR-0532](../../maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md) (optional context reads preserve reference-only alias capture)

## Context

Installed completion exposed three independent limits: canonical assessment selected up to 32 sources despite a smaller reviewed delegation workset; Flemo intentionally uses repository README file and portable-skill directory aliases; and Digimon's complete source inventory exceeds the default 256 MiB capture ceiling. Discarding those aliases or tracked assets would make full baseline currency false.

## Decision

Every canonical assessment workset obeys the delegation's `maximumDocuments` and `maximumSourceBytes`, plus the existing 512 KiB canonical request ceiling. Selection is contiguous at the durable canonical cursor. Reaching a count or byte ceiling preserves the next source for another independently reviewed workset. A first source that cannot fit records `knowledge_source_limit_exceeded`, never empty-scope success. Provider deadlines and call ceilings remain unchanged.

An exact reviewed version-one delegation may include optional `sourceCapture`, requiring `maximumRepositoryBytes` and `symbolicReferences`. The total repository ceiling defaults to 256 MiB, with an absolute 1 GiB limit. Existing limits of 20,000 paths and 64 MiB per ordinary file remain. Exceeding any limit requires attention; a partial manifest cannot authorize baseline currency.

Each of at most 32 symbolic references requires `path`, the exact relative `target` stored in the link, and `targetKind` (`file` or `directory`). The link and normalized target must remain inside the repository and outside Git and Lervo private metadata. Intermediate links and target-link chains are unsupported. A replaced link, changed target literal, incomplete target capture, wrong target kind, or escape fails closed. File targets and directory descendants must independently appear in the complete Git-governed source inventory. The runtime never follows an alias to import target bodies or traverse an alias directory, and never rewrites the link.

The captured source is an opaque, domain-marked canonical descriptor binding its kind, path, target literal, and target kind. Ordinary captured target hashes separately detect target-content changes. Existing opaque asset dispositions and pinned meaningful verification remain required for full lifecycle completion. Permission to capture a reference or larger inventory establishes no semantic coverage, independent review, asset approval, provider usage, or write authority.

Capture rechecks exact delegation bytes and the Git head. After expiry or revocation, inspection may use the last valid reviewed capture contract to observe debt. Execution still requires current project identity, active ancestry, roles, suites, provider scope, expiry, leases, and the exact reviewed delegation hash. Capture-setting changes use the existing content-bound delegation plan and durable apply journal.

## State, privacy, and failure meaning

No new public event or source kind is introduced. Reference descriptors, path literals, capture settings, and source manifests remain private review input or owner-only CAS. Public stage events retain IDs, hashes, counts, and bounded failure codes. The existing exact review hash binds all optional capture fields.

- `knowledge_authority_unavailable`: malformed capture settings, an unreviewed change, more than 32 references, an unsafe declaration, or a ceiling above the absolute limit.
- `knowledge_source_kind_unsupported`: an undeclared or changed link, a target chain or wrong kind, or a target absent from the complete captured inventory.
- `knowledge_source_limit_exceeded`: a complete inventory or first canonical workset source cannot fit its applicable reviewed ceiling.
- `source_bytes_changed`: source, link, target, delegation, or Git binding changed during observation or settlement; earlier review cannot authorize current success.
- `asset_verification_required`: captured opaque evidence lacks its exact verified disposition; capture alone is insufficient.

## Verification

Focused checks cover count and byte boundaries; contiguous complete cursor coverage; full convergence through multiple small independently reviewed canonical worksets; no provider call at the fixed point; ordinary source drift; file and directory references; target-content drift; escape; intermediate chains; reference replacement; missing ignored targets; tracked opaque assets; exact total capture limits; and the absolute ceiling.

Installed Flemo and Digimon inventory and final lifecycle acceptance remain required before their backlog is reported complete.

## References

- [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md)
- [Background convergence runtime](../../../../specs/background-knowledge-convergence/runtime.md)
- [Authority, assessment, and integration](../../../../specs/background-knowledge-convergence/authority-and-completion/authority-and-integration.md)
- [Autonomous background convergence](../../../../roadmap/knowledge/autonomous-background-convergence.md)
