# Repository development-pattern lifecycle

Status: `active`
As of: 2026-08-30

## Scope

Defines evidence, review, promotion, and stale-source contracts for reusable repository development patterns. The [repository knowledge compilation specification](repository-knowledge-compilation.md) owns scanning, compilation, reconciliation, and durable materialization. The [lifecycle convergence specification](repository-knowledge-lifecycle-convergence.md#canonicalization-assessment) separately owns completion-time canonicalization assessment.

## Proposal evidence

`knowledge pattern propose` binds at least two independently grouped current source units, exceptions, invariants, reasons, verification, and one responsibility-owned target. Provider identity is observation metadata; equivalent Codex and Claude proposals converge without increasing assurance.

For portable-skill candidates derived from completed workflows, every independent group also binds a distinct current passed verification event and run with exact event, suite, repository-revision, and result-content hashes. Occurrences bind current source and unit hashes. Candidates contain bounded `SKILL.md` and resource bytes and explicit input, output, tool, permission, provider, platform, role, and resource contracts. The derived skill manifest is content-bound, untrusted, and disabled; neither candidacy nor pattern review can select or activate it. Retrieval selection and provider agreement are not workflow evidence.

## Review and promotion

Candidates progress through `observed -> candidate -> reviewed -> promoted|rejected|deferred -> superseded`. Exact-hash review and separate promotion bind target hashes, verification, and both agent routes. Promotion creates a missing target or accepts identical bytes; different existing bytes block it. Non-check targets extend only the managed AGENTS route consumed by Claude's import.

Candidate and review bodies are immutable CAS artifacts; bounded events rebuild current state. Changed source makes unpromoted work stale and blocks apply, but never rewrites a promoted canonical target. Request keywords grant no authority, and user-owned content is never auto-promoted. Promotion creates only the responsibility-owned target; AGENTS and CLAUDE remain fixed and resolve that target through repository knowledge query.

Portable-skill promotion treats instructions, reviewed resources, and the derived manifest as one exact rollback unit. Apply rechecks source freshness and every referenced passed-verification coordinate. The promoted manifest remains disabled until the separate capability lifecycle receives exact authority; migration, trust, selection, activation, invocation, and completion retain their existing evidence meanings.

Missing, failed, duplicated, or changed verification evidence rejects the candidate before declaration. Candidate bodies remain in owner-only CAS; existing pattern events retain only bounded hashes, counts, target kind, provider, and lifecycle coordinates. Terminal declaration and initial pattern transitions commit in one event-store transaction. A pre-commit failure leaves at most an unreferenced CAS object; a projection-write failure leaves canonical events that `knowledge pattern status` can rebuild.

## Post-promotion effect observation

An accepted pattern may register an exact baseline protocol only while `reviewed`. After its exact promotion event, a separate treatment observation may compare the same adapter, metric set, and unchanged target. Protocol and comparison bodies are CAS artifacts; privacy-bounded events are canonical, and the current effect view is rebuildable. Comparison is observational, leaves attribution unestablished, and never authorizes automatic rollback or claims model learning, truth, correctness, or semantic use. The [verified improvement effect specification](../specifications/execution/verified-improvement-effects.md) owns metrics, timing, adapter, privacy, and failure meaning.

The first production local adapter derives only repository-wide verification success from bounded canonical verification-completion events. It re-observes exact evidence on apply and leaves unavailable every metric without a defined local counting unit. Collection does not change review, promotion, canonical-source, or rollback authority.
