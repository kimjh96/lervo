# ADR-0457: Degrade knowledge intake per file and consolidate documents

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0427](../repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md), [ADR-0434](../repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0195](../repository/0195-reviewed-document-content-normalization.md), [ADR-0451](../repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The installed Mac knowledge worker runs, yet of 57 per-change jobs none reached `current`. Verified causes:

- `MAXIMUM_REVIEW_BYTES = 256 KiB` (`packages/repository-knowledge/src/repository-knowledge-review-source.ts:15`) rejects the whole job as `attention_required / review_source_limit_exceeded` when one file or the running total exceeds it (lines 154-155, 213-215). More than 64 paths yields `repository_change_path_limit_exceeded` (`repository-knowledge-worker.ts:104-105`; schema `maxItems: 64`).
- `repository-change-source.ts:152-157` excludes only `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/`. `apps/cli/release-sbom.cdx.json`, `release-artifact-manifest.json`, and 42 tracked `.changes/*.yaml` files pass as review sources; `.changes/**` is excluded only for the scanner in `policy.yaml`.
- The v4 runtime's per-change review is a stub returning `needs_review` (`packages/repository-knowledge-runtime/src/worker.ts:66-68`), so every legacy change job settles `review_needs_attention`.
- ADR-0427 records `not_applicable` for every conversation turn that changed no bytes, so decisions made in conversation never become knowledge. The brief attributed this to Discord; the rule is surface-neutral.
- Durable-instruction capture runs only when an agent executes `lervo knowledge instruction intake`; the terminal path hardcodes the proposal as `ignored` (`apps/cli/src/terminal-prompt-context.ts:134-139`) and `terminal-request-grounding.ts` has no production caller.
- Ownership is host-local: the worker lock is a PID file, the delegation grant (`convergence-delegation.json`) has no host identity, and nothing prevents the Mac and WSL from converging and auto-committing the same repository independently, contrary to ADR-0434's "one convergence owner per repository".
- Normalization only splits (`document-normalization.ts:485-501`); merging exists solely as the manual `lervo knowledge structure merge`. There are no word or depth bounds. The result: 1,520 documents under `docs/`, 430 under 150 words, 56 at eight or nine directory levels, parallel `docs/specs` (88) and `docs/specifications` (345) trees, and 195 evidence journals treated as canonical sources.

## Decision

### One intake policy, per-file degradation

A single `knowledge-intake-policy` module owns inclusion for the scanner, the change source, and Node repository observation. Defaults add `.changes/**`, `**/release-*.json`, `**/release-sbom*.json`, `**/*.lock`, and `pnpm-lock.yaml` to the generated set; projects extend it in `policy.yaml`. Excluded paths stay in the manifest as `disposition: generated`, so the count is visible rather than silently dropped.

The byte ceiling becomes per file. A file that is oversize, binary, or generated receives `fileDisposition: skipped_oversize | skipped_binary | skipped_generated` and the job continues with the remaining files. `current` still requires every reviewable file reviewed; the resolved event records the skipped count and reasons. Jobs with more than 64 paths split into ordered sub-jobs that share one completion and settle together; `repository_change_path_limit_exceeded` is retired. The v4 stub is replaced by the ADR-0427 no-capability reviewer, and legacy `review_needs_attention` jobs are re-queued once.

### Conversation decisions are knowledge sources

The managed turn contract gains an optional `knowledgeCandidate: { kind: decision | instruction | fact; summary; subjectKey }` output, requested by default. A turn that changed no bytes but returned a candidate records `conversation.knowledge_candidate.recorded` and enqueues a knowledge job with the new source kind `conversation_decision`; the reviewer resolves it to a canonical target or `implementation_only` through the existing candidate lifecycle. `not_applicable` now means the turn produced neither bytes nor a candidate. The same path serves ADR-0453 settlements that should become repository policy.

### Instruction capture is wired

On terminal `Stop`, the deterministic grounding already in `terminal-request-grounding.ts` runs on the user's prompt (no provider call, bounded to 200 ms under ADR-0451) and creates a durable-instruction candidate with status `captured_pending_review`; the next prompt context states "1 instruction candidate captured". Conversation turns capture through `knowledgeCandidate.kind: instruction`. Review and materialization stay exact and reviewed.

### One convergence owner across hosts

The knowledge convergence owner runs only on the host holding the repository writer lease (ADR-0456) or, without a lease, on the host named by a new `hostIdentityHash` in the delegation grant. Other hosts run read-only inspection and send candidates through handoff or the Hub. `knowledge.convergence.owner.changed` records holder changes; a non-owner host that finds debt records `convergence_owner_elsewhere` and does not commit.

Amended by [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md): the owner is the holder of a Hub-hosted, expiring convergence owner lease, not the ADR-0456 writer lease, and host identity lives in host-local state, not in the delegation grant. ADR-0466 also redefines the `knowledge.convergence.owner.changed` fields.

### Consolidation normalization

Normalization gains `merge`, `flatten`, `retire_to_projection`, and `dedupe_trees` operations beside `split`, generated as reviewed candidates and applied through the ADR-0434 delegated review:

- `merge` folds sibling documents under `minimumDocumentWords` (default 150; entrypoints and decision records exempt) with the same parent and no distinct responsibility into the parent.
- `flatten` hoists families deeper than `maximumDirectoryDepth` (default 6 directory levels under `docs/`).
- `retire_to_projection` moves evidence journals out of the canonical roots: `docs/evidence` stays in Git for links and audit but leaves `canonicalRoots` and `normalizationRoots`; an index page remains canonical.
- `dedupe_trees` converges `docs/specs` into `docs/specifications` with link rewrites, one family at a time.

The bounds live in `document-layout.yaml` beside the existing capacity policy. Generated proposals never apply without the exact reviewed candidate.

## Events, states, and failure meaning

- `repository.knowledge.resolved` gains additive `skippedPathCount`, `skippedReasons`, `subJobIndex`, and `subJobCount`.
- `conversation.knowledge_candidate.recorded`: `conversationEventId`, `agentId`, `kind`, `subjectKeyDigest`, `summaryHash`, `candidateId`, `occurredAt`. Summaries live in CAS, not events. Failure `knowledge_candidate_invalid` means the candidate was dropped and the turn still completed.
- `knowledge.instruction_candidate.captured`: `candidateId`, `source` (`terminal_prompt | conversation`), `promptDigest`, `occurredAt`.
- `knowledge.convergence.owner.changed`: `repositoryIdentityHash`, `hostIdentityHash` or null, `reason` (`lease | delegation | release`), `occurredAt`.
- `knowledge.normalization.consolidation.proposed`: `candidateId`, `operation`, `inputDocumentCount`, `outputDocumentCount`, `occurredAt`.
- Failure codes: `convergence_owner_elsewhere`, `consolidation_responsibility_conflict` (merge refused because inputs own distinct responsibilities).

## Migration

1. Ship the intake policy and per-file degradation; re-queue the 57 jobs.
2. Replace the v4 stub reviewer; activate the conversation-decision source and instruction capture.
3. Record the convergence owner on the Lervo repository; WSL becomes read-only for knowledge until the lease moves.
4. Run consolidation on `docs/evidence`, then the shortest 430 documents, then `docs/specs`, each as reviewed candidate batches; link validity is checked by `pnpm docs:check` after every batch.

## Acceptance (installed)

- Over seven days on the Lervo repository, at least 90 percent of per-change jobs reach `current`; no generated artifact appears as a review source.
- A Discord decision with no byte change becomes a canonical document through candidate review.
- A "from now on" terminal prompt yields a candidate visible in `lervo knowledge instruction review` without an agent command.
- Mac and WSL never both commit knowledge outputs for one repository; the owner event history shows one holder at a time.
- Documents under 150 words fall below 100, the maximum depth is six directory levels, and one specification tree remains, with `lervo knowledge lint` and `pnpm docs:check` passing.

## Deferred

Embedding-based retrieval, cross-repository knowledge sharing, and unreviewed automatic apply.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [Autonomous background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
- [Document normalization renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
