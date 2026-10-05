# ADR-0457: Degrade knowledge intake per file and consolidate documents

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0427](../repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md), [ADR-0434](../repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0195](../repository/0195-reviewed-document-content-normalization.md), [ADR-0451](../repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The installed Mac knowledge worker runs, but none of 57 per-change jobs reached `current`. Verified causes:

- `MAXIMUM_REVIEW_BYTES = 256 KiB` (`packages/repository-knowledge/src/repository-knowledge-review-source.ts:15`) rejects the entire job as `attention_required / review_source_limit_exceeded` when one file or the running total exceeds it (lines 154-155, 213-215). More than 64 paths yields `repository_change_path_limit_exceeded` (`repository-knowledge-worker.ts:104-105`; schema `maxItems: 64`).
- `repository-change-source.ts:152-157` excludes only `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/`. Review sources therefore include `apps/cli/release-sbom.cdx.json`, `release-artifact-manifest.json`, and 42 tracked `.changes/*.yaml` files. In `policy.yaml`, `.changes/**` is excluded only for the scanner.
- The v4 per-change reviewer is a stub returning `needs_review` (`packages/repository-knowledge-runtime/src/worker.ts:66-68`); every legacy change job settles `review_needs_attention`.
- ADR-0427 assigns `not_applicable` to every conversation turn that changes no bytes, excluding conversation decisions from knowledge. This rule is surface-neutral, despite the brief attributing it to Discord.
- Durable-instruction capture requires an agent to execute `lervo knowledge instruction intake`. The terminal path hardcodes the proposal as `ignored` (`apps/cli/src/terminal-prompt-context.ts:134-139`), and `terminal-request-grounding.ts` has no production caller.
- Ownership is host-local: the worker uses a PID-file lock, `convergence-delegation.json` has no host identity, and Mac and WSL can independently converge and auto-commit the same repository, violating ADR-0434's one-convergence-owner requirement.
- Normalization only splits (`document-normalization.ts:485-501`); merging requires manual `lervo knowledge structure merge`. No word or depth bounds exist. Under `docs/`, there are 1,520 documents, 430 under 150 words, and 56 at eight or nine directory levels. Parallel `docs/specs` and `docs/specifications` trees contain 88 and 345 documents respectively; 195 evidence journals are treated as canonical sources.

## Decision

### One intake policy, per-file degradation

One `knowledge-intake-policy` module controls inclusion for the scanner, change source, and Node repository observation. Defaults add `.changes/**`, `**/release-*.json`, `**/release-sbom*.json`, `**/*.lock`, and `pnpm-lock.yaml` to the generated set; projects extend it in `policy.yaml`. Excluded paths remain in the manifest as `disposition: generated`, preserving visible counts.

The byte ceiling applies per file. Oversize, binary, or generated files receive `fileDisposition: skipped_oversize | skipped_binary | skipped_generated`; the job continues with remaining files. `current` still requires review of every reviewable file, and the resolved event records skipped counts and reasons. Jobs exceeding 64 paths split into ordered sub-jobs with shared completion that settle together; `repository_change_path_limit_exceeded` is retired. Replace the v4 stub with ADR-0427's no-capability reviewer and re-queue legacy `review_needs_attention` jobs once.

### Conversation decisions are knowledge sources

The managed turn contract gains optional output `knowledgeCandidate: { kind: decision | instruction | fact; summary; subjectKey }`, requested by default. A no-byte-change turn returning a candidate records `conversation.knowledge_candidate.recorded` and enqueues a job with source kind `conversation_decision`. Through the existing candidate lifecycle, the reviewer resolves it to a canonical target or `implementation_only`.

`not_applicable` means the turn produced neither bytes nor a candidate. ADR-0453 settlements that should become repository policy use the same path.

### Instruction capture is wired

On terminal `Stop`, the existing deterministic grounding in `terminal-request-grounding.ts` runs on the user's prompt without a provider call, bounded to 200 ms under ADR-0451. It creates a durable-instruction candidate with status `captured_pending_review`; the next prompt context states "1 instruction candidate captured". Conversation turns capture through `knowledgeCandidate.kind: instruction`. Review and materialization remain exact and reviewed.

### One convergence owner across hosts

The knowledge convergence owner runs only on the host holding the repository writer lease (ADR-0456) or, without a lease, the host identified by new delegation-grant field `hostIdentityHash`. Other hosts inspect read-only and send candidates through handoff or the Hub.

`knowledge.convergence.owner.changed` records holder changes. A non-owner host finding debt records `convergence_owner_elsewhere` and does not commit.

### Consolidation normalization

Alongside `split`, normalization gains four operations, generated as reviewed candidates and applied through ADR-0434 delegated review:

- `merge`: fold sibling documents below `minimumDocumentWords` (default 150) into their parent when they share that parent and have no distinct responsibility. Entrypoints and decision records are exempt.
- `flatten`: hoist families deeper than `maximumDirectoryDepth` (default six directory levels under `docs/`).
- `retire_to_projection`: remove evidence journals from canonical roots. `docs/evidence` remains in Git for links and audit but leaves `canonicalRoots` and `normalizationRoots`; an index page remains canonical.
- `dedupe_trees`: converge `docs/specs` into `docs/specifications`, rewriting links one family at a time.

Bounds live in `document-layout.yaml` beside the existing capacity policy. Generated proposals never apply without the exact reviewed candidate.

## Events, states, and failure meaning

- `repository.knowledge.resolved` gains additive fields `skippedPathCount`, `skippedReasons`, `subJobIndex`, and `subJobCount`.
- `conversation.knowledge_candidate.recorded` contains `conversationEventId`, `agentId`, `kind`, `subjectKeyDigest`, `summaryHash`, `candidateId`, and `occurredAt`. Summaries live in CAS, not events. Failure `knowledge_candidate_invalid` drops the candidate while allowing the turn to complete.
- `knowledge.instruction_candidate.captured` contains `candidateId`, `source` (`terminal_prompt | conversation`), `promptDigest`, and `occurredAt`.
- `knowledge.convergence.owner.changed` contains `repositoryIdentityHash`, `hostIdentityHash` or null, `reason` (`lease | delegation | release`), and `occurredAt`.
- `knowledge.normalization.consolidation.proposed` contains `candidateId`, `operation`, `inputDocumentCount`, `outputDocumentCount`, and `occurredAt`.
- Failure codes include `convergence_owner_elsewhere` and `consolidation_responsibility_conflict`; the latter refuses a merge because inputs own distinct responsibilities.

## Migration

1. Ship the intake policy and per-file degradation; re-queue the 57 jobs.
2. Replace the v4 stub reviewer; activate the conversation-decision source and instruction capture.
3. Record the Lervo repository's convergence owner; WSL becomes read-only for knowledge until the lease moves.
4. Consolidate `docs/evidence`, then the shortest 430 documents, then `docs/specs`, using reviewed candidate batches. Check link validity with `pnpm docs:check` after every batch.

## Acceptance (installed)

- Over seven days on the Lervo repository, at least 90 percent of per-change jobs reach `current`; no generated artifact appears as a review source.
- A Discord decision with no byte change becomes a canonical document through candidate review.
- A "from now on" terminal prompt produces a candidate visible in `lervo knowledge instruction review` without an agent command.
- Mac and WSL never both commit knowledge outputs for one repository; owner event history shows one holder at a time.
- Fewer than 100 documents remain under 150 words, maximum depth is six directory levels, and one specification tree remains. `lervo knowledge lint` and `pnpm docs:check` pass.

## Deferred

Embedding-based retrieval, cross-repository knowledge sharing, and unreviewed automatic apply.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [Autonomous background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
- [Document normalization renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
