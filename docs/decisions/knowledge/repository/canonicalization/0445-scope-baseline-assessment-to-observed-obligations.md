# ADR-0445: Scope baseline assessment to observed source obligations

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md) and [ADR-0436](0436-reviewed-source-capture-and-bounded-canonical-worksets.md)

## Context

The installed Mac baseline captured 6,810 repository entries and selected 5,371 ordinary text files for semantic assessment, including committed code, tests, generated release metadata, and documents without observed change obligations. Eight-file batches required hundreds of provider assessments and independent reviews before lifecycle verification. An assessor falsely claimed existing components were absent, causing rejection of a generated SBOM batch. Repeated source edits superseded the baseline and repeated provider work.

Complete capture supports drift detection; captured text does not automatically create a documentation claim.

## Decision

- Preserve the complete Git-governed source inventory, source bytes, opaque asset obligations, and exact snapshot checks. Include the current Git changed-path set in the snapshot hash so changes to assessment eligibility supersede a prior baseline.
- Select semantic assessment paths from the union of current tracked changes against `HEAD`, untracked nonignored files, unresolved repository change events, pending document normalization paths, and pending or stale canonicalization candidate source bindings. Recover overflow change paths from their exact local CAS source manifest. Validate its digest, byte count, source event, and path count; missing or malformed evidence fails closed.
- Provider worksets contain only captured ordinary text with a semantic source disposition. Sensitive and policy-excluded paths retain explicit dispositions; opaque assets retain separate typed verification. Never present deleted or consumed artifacts as current text. Historical event obligations remain durable until lifecycle settlement; excluding them from text assessment does not resolve them.
- Bind the selected path set into baseline debt identity. Independently reviewed batches must cover every selected text source through the contiguous durable cursor and exact source and context hashes. Reuse approved batches only under their existing exact bindings.
- If independent semantic review rejects a batch with no pending document normalization, retain its exact feedback in private stage state and reassess the same cursor once. Pass reviewer rationale to the next assessment as untrusted evidence. A second rejection remains `attention_required`; no rejected batch advances coverage or integrates a draft.
- For a selected CycloneDX source, compute component and dependency-reference membership from its complete captured bytes. Bind the resulting counts and missing-reference lists to its source hash and supply these deterministic facts to both assessor and independent reviewer. A model may assess semantic impact, but any asserted missing component must appear in the computed missing-reference list.
- When a selected release manifest names an archived package README, supply its exact separately captured README bytes, byte count, and hash comparison to both assessor and reviewer. This establishes guide content and manifest binding without treating an unobserved packed smoke or publication as complete.
- Before broad recommendations fill a mixed workset's review context, reserve one source-specific recommendation for each available code source. Prioritize code that appends a dotted event. Query both its event, idempotency, and recovery authority and its implementation authority so a late source retains its contract. Keep the existing context document and byte ceilings.
- Full currency requires the complete source snapshot, current normalization records, resolved canonical candidates and historical obligations, ordered migration and lint, and final lifecycle verification.
- Capture stable committed files without observed unresolved changes for drift detection without creating semantic work. This does not claim every committed file has received semantic review.

## Failure and privacy

An invalid change manifest or unsafe path reports `knowledge_job_source_invalid`. Changed source bytes or a changed Git path set reports `source_bytes_changed`. Source paths and manifest bodies remain private. Public events retain bounded hashes, counts, and existing failure codes. This decision adds no event or provider authority.

## Verification

Focused tests must:

- Distinguish committed files from changed tracked and untracked paths, exclude ignored files, and retain complete capture.
- Require exact coverage of selected sources.
- Stop repeated semantic rejection after one feedback retry.
- Distinguish real CycloneDX dangling references from model claims about an incomplete scan.
- Bind an archived package guide to its exact captured bytes.
- Retain a late code source's event contract ahead of broad mixed-workset recommendations.

Installed verification must show fewer reviewed sources, preserved asset and historical obligations, no provider work for unrelated committed files, and `baselineCurrent` only after all remaining lifecycle gates pass.
