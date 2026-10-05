# ADR-0457: Degrade knowledge intake per file and consolidate documents

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0427](../repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md), [ADR-0434](../repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0195](../repository/0195-reviewed-document-content-normalization.md), [ADR-0451](../repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The installed Mac knowledge worker runs, but none of 57 per-change jobs reached `current`. Verified causes:

- `MAXIMUM_REVIEW_BYTES = 256 KiB` (`packages/repository-knowledge/src/repository-knowledge-review-source.ts:15`) rejects the entire job as `attention_required / review_source_limit_exceeded` when one file or the running total exceeds it (lines 154-155, 213-215). More than 64 paths yields `repository_change_path_limit_exceeded` (`repository-knowledge-worker.ts:104-105`; schema `maxItems: 64`).
- `repository-change-source.ts:152-157` excludes only `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/`. Review sources still include `apps/cli/release-sbom.cdx.json`, `release-artifact-manifest.json`, and 42 tracked `.changes/*.yaml` files; `policy.yaml` excludes `.changes/**` only for the scanner.
- The v4 per-change reviewer is a `needs_review` stub (`packages/repository-knowledge-runtime/src/worker.ts:66-68`), settling every legacy change job as `review_needs_attention`.
- ADR-0427 records `not_applicable` for turns without byte changes, excluding conversational decisions. Despite the brief's Discord attribution, this rule is surface-neutral.
- Durable-instruction capture requires an agent to run `lervo knowledge instruction intake`. The terminal path hardcodes proposals as `ignored` (`apps/cli/src/terminal-prompt-context.ts:134-139`); `terminal-request-grounding.ts` has no production caller.
- A host-local PID-file worker lock and delegation grant (`convergence-delegation.json`) without host identity let Mac and WSL independently converge and auto-commit, violating ADR-0434's single convergence owner requirement.
- Normalization only splits (`document-normalization.ts:485-501`); merging requires manual `lervo knowledge structure merge`. There are no word or depth bounds. Of 1,520 documents under `docs/`, 430 have fewer than 150 words and 56 sit eight or nine directory levels deep. Parallel trees contain 88 documents in `docs/specs` and 345 in `docs/specifications`; 195 evidence journals are canonical sources.

## Decision

### One intake policy, per-file degradation

One `knowledge-intake-policy` module controls inclusion for the scanner, change source, and Node repository observation. Defaults add `.changes/**`, `**/release-*.json`, `**/release-sbom*.json`, `**/*.lock`, and `pnpm-lock.yaml` to the generated set; projects extend it through `policy.yaml`. Excluded paths remain in the manifest as `disposition: generated` so their count stays visible.

The byte ceiling becomes per-file. Oversize, binary, and generated files receive `fileDisposition: skipped_oversize | skipped_binary | skipped_generated`; jobs continue with remaining files. `current` still requires every reviewable file to be reviewed, and resolved events record skipped counts and reasons. Jobs exceeding 64 paths split into ordered sub-jobs sharing one completion and settling together; retire `repository_change_path_limit_exceeded`. Replace the v4 stub with ADR-0427's no-capability reviewer and re-queue legacy `review_needs_attention` jobs once.

### Conversation decisions are knowledge sources

The managed turn contract adds optional output `knowledgeCandidate: { kind: decision | instruction | fact; summary; subjectKey }`, requested by default. A turn without byte changes that returns a candidate records `conversation.knowledge_candidate.recorded` and enqueues a `conversation_decision` knowledge job. Through the existing candidate lifecycle, the reviewer resolves it to a canonical target or `implementation_only`. `not_applicable` means neither bytes nor a candidate were produced. ADR-0453 settlements intended as repository policy use this path.

### Instruction capture is wired

On terminal `Stop`, deterministic grounding in `terminal-request-grounding.ts` processes the user's prompt without a provider call, bounded to 200 ms under ADR-0451. It creates a durable-instruction candidate with status `captured_pending_review`; the next prompt context states "1 instruction candidate captured". Conversation turns capture through `knowledgeCandidate.kind: instruction`. Review and materialization remain exact and reviewed.

### One convergence owner across hosts

The original decision restricted convergence to the repository's ADR-0456 writer-lease holder or, without a lease, the host named by a new delegation-grant `hostIdentityHash`. Other hosts perform read-only inspection and send candidates through handoff or the Hub. `knowledge.convergence.owner.changed` records holder changes. Non-owners finding debt record `convergence_owner_elsewhere` and do not commit.

[ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) amends ownership: the owner holds a Hub-hosted, expiring convergence owner lease, separate from the ADR-0456 writer lease. Host identity resides in host-local state, outside the delegation grant. ADR-0466 also redefines `knowledge.convergence.owner.changed` fields.

### Consolidation normalization

Normalization adds `merge`, `flatten`, `retire_to_projection`, and `dedupe_trees` alongside `split`. Operations become reviewed candidates applied through ADR-0434 delegated review:

- `merge`: fold sibling documents below `minimumDocumentWords` (default 150; entrypoints and decision records exempt) into their shared parent only when they lack distinct responsibilities.
- `flatten`: hoist families deeper than `maximumDirectoryDepth` (default six directory levels under `docs/`).
- `retire_to_projection`: remove evidence journals from canonical roots. Keep `docs/evidence` in Git for links and audit, but remove it from `canonicalRoots` and `normalizationRoots`; retain a canonical index page.
- `dedupe_trees`: converge `docs/specs` into `docs/specifications`, rewriting links one family at a time.

Bounds live beside the existing capacity policy in `document-layout.yaml`. Generated proposals never apply without the exact reviewed candidate.

## Events, states, and failure meaning

- `repository.knowledge.resolved` adds `skippedPathCount`, `skippedReasons`, `subJobIndex`, and `subJobCount`.
- `conversation.knowledge_candidate.recorded` contains `conversationEventId`, `agentId`, `kind`, `subjectKeyDigest`, `summaryHash`, `candidateId`, and `occurredAt`. Summaries live in CAS, never events. `knowledge_candidate_invalid` means the candidate was dropped but the turn completed.
- `knowledge.instruction_candidate.captured` contains `candidateId`, `source` (`terminal_prompt | conversation`), `promptDigest`, and `occurredAt`.
- The original `knowledge.convergence.owner.changed` fields were `repositoryIdentityHash`, `hostIdentityHash` or null, `reason` (`lease | delegation | release`), and `occurredAt`; ADR-0466 redefines them.
- `knowledge.normalization.consolidation.proposed` contains `candidateId`, `operation`, `inputDocumentCount`, `outputDocumentCount`, and `occurredAt`.
- Failure codes include `convergence_owner_elsewhere` and `consolidation_responsibility_conflict` (merge refused because inputs have distinct responsibilities).

## Migration

1. Ship intake policy and per-file degradation; re-queue the 57 jobs.
2. Replace the v4 stub reviewer; activate the conversation-decision source and instruction capture.
3. Record the Lervo repository's convergence owner; WSL remains read-only for knowledge until the lease moves.
4. Consolidate `docs/evidence`, then the shortest 430 documents, then `docs/specs`, using reviewed candidate batches. Run `pnpm docs:check` after every batch to check links.

## Acceptance (installed)

- Over seven days on the Lervo repository, at least 90 percent of per-change jobs reach `current`; no generated artifact is a review source.
- A Discord decision without byte changes becomes a canonical document through candidate review.
- A "from now on" terminal prompt creates a candidate visible in `lervo knowledge instruction review` without an agent command.
- Mac and WSL never both commit knowledge outputs for one repository; owner event history shows one holder at a time.
- Fewer than 100 documents remain below 150 words, maximum depth is six directory levels, and one specification tree remains; `lervo knowledge lint` and `pnpm docs:check` pass.

## Deferred

Embedding-based retrieval, cross-repository knowledge sharing, and unreviewed automatic apply.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [Autonomous background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
- [Document normalization renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
