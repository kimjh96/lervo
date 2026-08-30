# Repository development-pattern lifecycle

Status: `active`
As of: 2026-08-30

## Scope

Defines the evidence, review, promotion, and stale-source contract for reusable repository development patterns. The main [repository knowledge compilation specification](repository-knowledge-compilation.md) owns scanning, compilation, reconciliation, and durable materialization. The [lifecycle convergence specification](repository-knowledge-lifecycle-convergence.md#canonicalization-assessment) separately owns completion-time canonicalization assessment.

## Proposal evidence

`knowledge pattern propose` binds at least two independently grouped current source units, exceptions, invariants, reasons, verification, and one responsibility-owned target. Provider identity is observation metadata; equivalent Codex and Claude proposals converge without increasing assurance.

## Review and promotion

Candidates move through `observed -> candidate -> reviewed -> promoted|rejected|deferred -> superseded`. Exact-hash review and separate promotion bind target hashes, verification, and both agent routes. Promotion creates a missing target or accepts identical bytes; different existing bytes block. Non-check targets extend only the managed AGENTS route consumed by Claude's import.

Candidate and review bodies are immutable CAS artifacts; bounded events rebuild current state. Changed source makes unpromoted work stale and blocks apply, but never rewrites a promoted canonical target. Request keywords grant no authority, and user-owned content is never auto-promoted. Promotion creates only the responsibility-owned target; AGENTS and CLAUDE stay fixed and resolve that target through repository knowledge query.
