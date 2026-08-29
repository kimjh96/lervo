# Linked-evidence shadow phase A collection preflight

Status: `observed_blocked`
Date: 2026-08-28

## Question

Can this repository produce the immutable phase A observation set required by [ADR-0248](../../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md) without changing operational search, managed context, or provider behavior?

## Bound inputs

- Repository project: `prj_ab094111596346d7`
- Operational engine: `lexical-v1`, with no selection transition
- Registered-document storage: no manifests or legacy registry; the production loader returned zero sources
- Public suite: `linked-evidence-reconciliation-v8`, eight cases, `sha256:28775d1126269ce42c961d15c3b7cd8deb5affe6f7e730678f223c0b6dfd2f20`
- Search limit: five recommendations; selection policy: `top_ranked-v1`, maximum three
- Shadow bounds: one link hop, eight retained documents, 65,536 UTF-8 source bytes

## Method

The preflight loaded the corpus through the production registered-document loader. It ran all eight checked-in public v8 queries through the production operational engine resolver, constructed ordinary recommendation batches, and evaluated deterministic shadow projections in memory.

It did not call a provider, start a managed run, record a search attempt, write a shadow observation, change a document manifest, or change E1-E4 context.

## Result

| Measure | Observed |
| --- | ---: |
| Registered documents | 0 |
| Public queries inspected | 8 |
| Queries with lexical hits | 0 |
| Selected lexical recommendations | 0 |
| Nonempty linked-candidate projections | 0 |
| Provider calls | 0 |
| Phase A observations written | 0 |

The implementation follows ADR-0248: projection seeds only from selected operational lexical recommendations in the current registered corpus. Because no documents are registered, every eligible run would have an empty recommendation seed. Repeating 30 managed runs therefore cannot produce the required minimum of 10 nonempty projections.

Registering the repository documents is not a neutral collection method. It would populate operational search and may change recommendations, E1 selection, E2 loading, and E3 injection. Seeding the shadow from repository-knowledge recommendations or another corpus would change the accepted phase A contract. Neither action is authorized by the current decision.

## Required population decision

Before provider execution, the next review must select and bind one population:

1. Run an isolated, explicitly approved pilot in a representative repository that already has a nonempty registered corpus. This preserves ADR-0248 and this repository's behavior, but limits the incidence claim to that pilot population.
2. Adopt documents into this repository under the metadata-only document contract, with a separate decision acknowledging the operational-search and managed-context effects.
3. Revise ADR-0248 to define another shadow-only seed or corpus, then repeat parity, no-effect, privacy, release, and lifecycle verification before collection.

The recommended option is the isolated registered-corpus pilot because it preserves the production boundary. This preflight proves only that the current repository cannot supply the required population; it neither rejects linked-evidence projection nor authorizes a provider shadow.

## References

- [Stage linked-evidence reconciliation activation](../../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md)
- [Search recommendation and managed-context boundary](../../decisions/search/0054-search-recommendation-managed-context-boundary.md)
- [Existing-document adoption](../../decisions/knowledge/documents/0018-existing-document-adoption.md)
- [Natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md)
