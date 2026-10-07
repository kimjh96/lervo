# ADR-0474: Name normalization documents outside the delegation

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0472](0472-start-absent-integration-refs-and-bound-untyped-stage-failures.md)

## Context

After ADR-0472 unblocked canonical integration in `argo`, obligation `kconv_7d42dc8b264f67d14d858bad` reached `normalization_generation` at 05:40:06 UTC on 2026-10-06. It recorded `waiting_authority/knowledge_authority_unavailable`; its private dependency contained only `kind: normalization_scope`, the snapshot hash, and the delegation hash.

The delegated normalization roots are `docs`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `FINAL-DESIGN.md`, and `IMPLEMENTATION-HANDOFF.md`. All eleven pending documents lie under `v4/`: `v4/DESIGN.md`, nine files under `v4/DESIGN/`, and `v4/README.md`. Generation filtered them to the delegated roots, selected nothing, and reported the code for a missing, expired, or mismatched delegation. All delegation bindings were valid, so the code misidentified the cause.

Normalizing `v4/` would widen reviewed authority. Lervo must not add roots automatically, and lifecycle verification cannot claim currency while these documents remain pending.

## Decision

- When every pending normalization document lies outside the delegated normalization roots, generation records `waiting_authority/knowledge_normalization_outside_delegation` without a provider call.
- The private dependency binds the snapshot hash, delegation hash, pending count, up to 256 sorted pending paths, and `outsideRoots`. `outsideRoots` contains the narrowest roots the delegation would need to add: each document's parent directory, or the file itself for a repository-root file, collapsed to the outermost entries.
- Owner status adds `scopeGap: { pendingDocuments, outsideNormalizationRoots }` only for this reason, using that exact dependency.
- Source or delegation changes reevaluate the stage under existing dependency rules. The owner can apply a reviewed delegation adding the reported roots or exclude the documents through `normalization.exclude` in `.lervo/knowledge/policy.yaml`.
- Other scope failures retain `knowledge_authority_unavailable`: a provider-call ceiling below two or a first document larger than the byte ceiling.

## Failure and privacy

This decision adds no event type or state. It adds one failure code:

| Code | State | Meaning | Recovery |
| --- | --- | --- | --- |
| `knowledge_normalization_outside_delegation` | `waiting_authority` | Every pending normalization document is outside the delegated normalization roots. | Add the reported roots through a reviewed delegation or exclude the documents from normalization. |

Public events carry only the code. Paths remain in the private CAS dependency. Status shows only repository-relative directory or root-file names and a count, never document bodies.

## Verification

Focused tests must show:

- Generation with only out-of-scope pending documents records the new code and dependency without a provider call.
- Status adds `scopeGap` only for this reason.
- Excluded paths reduce to the narrowest outer roots.

Installed verification must show `argo` status naming `v4` until the owner decides.
