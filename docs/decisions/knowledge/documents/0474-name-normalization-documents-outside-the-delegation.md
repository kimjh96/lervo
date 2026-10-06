# ADR-0474: Name normalization documents outside the delegation

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0472](0472-start-absent-integration-refs-and-bound-untyped-stage-failures.md)

## Context

After ADR-0472 unblocked canonical integration in the `argo` repository, obligation `kconv_7d42dc8b264f67d14d858bad` reached `normalization_generation` at 05:40:06 UTC on 2026-10-06. It recorded `waiting_authority/knowledge_authority_unavailable`. Its private dependency held only `kind: normalization_scope`, the snapshot hash, and the delegation hash.

The delegation's normalization roots are `docs`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `FINAL-DESIGN.md`, and `IMPLEMENTATION-HANDOFF.md`. All eleven pending normalization documents are under `v4/`: `v4/DESIGN.md`, nine files under `v4/DESIGN/`, and `v4/README.md`. Generation filters pending documents to the delegated roots, so it found nothing to select. It then reported the same code used for a missing, expired, or mismatched delegation. The delegation bindings were all valid, so the code pointed the owner at the wrong cause.

Normalizing `v4/` would widen reviewed authority. Lervo must not add roots automatically, and lifecycle verification cannot claim currency while those documents stay pending.

## Decision

- When every pending normalization document lies outside the delegated normalization roots, generation records `waiting_authority/knowledge_normalization_outside_delegation`. It makes no provider call.
- The private dependency binds the snapshot hash, the delegation hash, the pending count, up to 256 sorted pending paths, and `outsideRoots`. `outsideRoots` holds the narrowest roots that the delegation would have to add: each document's parent directory, or the file itself at the repository root, collapsed to the outermost entries.
- Owner status for this reason adds `scopeGap: { pendingDocuments, outsideNormalizationRoots }`, read from that exact dependency.
- A source or delegation change reevaluates the stage under the existing dependency rules. The owner can apply a reviewed delegation that adds the reported roots, or exclude those documents with `normalization.exclude` in `.lervo/knowledge/policy.yaml`.
- Other scope failures keep `knowledge_authority_unavailable`: a provider-call ceiling below two, or a first document larger than the byte ceiling.

## Failure and privacy

This decision adds no event type or state. It adds one failure code:

| Code                                         | State               | Meaning                                                                            | Recovery                                                                                      |
| -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `knowledge_normalization_outside_delegation` | `waiting_authority` | Every pending normalization document is outside the delegated normalization roots. | Add the reported roots in a reviewed delegation, or exclude the documents from normalization. |

Public events carry only the code. Paths stay in the private CAS dependency. Status shows only repository-relative directory or root-file names and a count, never document bodies.

## Verification

Focused tests must show:

- Generation with only out-of-scope pending documents records the new code and dependency without a provider call.
- Status adds `scopeGap` for that reason only.
- Excluded paths reduce to the narrowest outer roots.

Installed verification must show `argo` status naming `v4` until the owner decides.
