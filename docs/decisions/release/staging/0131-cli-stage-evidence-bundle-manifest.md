# ADR-0131: Stage-Evidence Bundle Manifest

- Status: accepted
- Decision date: 2026-08-21

## Context

Stage transition needs six sources through five paths. Repeating them invites mistakes, while copying their bodies into one document obscures ownership and grows without bound.

## Decision

`first_publication_stage_evidence_bundle` is a derived convenience manifest. Relative to its directory, it references the stage review, decision, authorization, approval-result directory, and reconciliation report. File references carry canonical document digests; result references carry attempt and terminal digests. It copies no bodies, absolute paths, target, outcome, actor, stage ID, or response.

Paths must remain beneath the manifest directory. Absolute paths, empty segments, dot segments, backslashes, and NUL are rejected. The manifest is canonical JSON, at most 16 KiB, mode 0600, and exclusively created. Sources remain independent.

Generation and transition consumption share the complete evidence-set validator. Generation rechecks every source before writing. Consumption opens and recomputes every source instead of trusting reference digests, then rechecks them after online observation. Bundle and legacy five-path inputs are mutually exclusive.

## Consequences

One bundle replaces repetitive arguments without changing provenance, freshness, or authority. It grants no publication, retry, completion, or runtime state. Mutation, escape, redigest, mixed input, and existing output fail closed.
