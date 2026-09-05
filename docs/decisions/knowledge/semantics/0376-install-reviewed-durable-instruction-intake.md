---
lervo:
  decision:
    taxonomy: decisions.default
    route: knowledge.semantics
---

# ADR-0376: Install reviewed durable-instruction intake

Status: `accepted`
Decision date: 2026-09-06

## Context

ADR-0304 defined strict typed durable-rule gates and deterministic generated Markdown, but its direct-hook implementation wrote eligible rules during prompt preparation. ADR-0327 removed effect grounding and repository mutation from unmanaged `UserPromptSubmit` hooks. The domain planner and materializer remained without an installed authority-bearing consumer to turn explicit runtime instructions into exact review candidates.

Restoring automatic hook mutation would combine availability-sensitive retrieval, provider semantic judgment, approval, and repository writes. A library-only API would leave the implementation gap.

## Decision

Install an explicit `lervo knowledge instruction` lifecycle with three responsibilities:

1. `intake --provider <codex|claude> (--from <json-path>|--stdin)` accepts one exact `{schemaVersion:1,request}` object. The current provider's no-capability grounding adapter classifies it against the complete bounded canonical-instruction catalog. Existing conjunctive speech-act, explicit-authority, repository-duration, additive-operation, bounded-scope, low-risk, no-conflict, high-confidence, ready-grounding, and no-ambiguity gates remain unchanged.
2. Eligible output becomes one local review candidate containing the normalized typed instruction, exact proposed Markdown and content hash, source snapshot, plan coordinates, and request and resolver digests. It excludes the raw request and provider output. Intake changes no canonical instruction.
3. `review <candidate-id> --decision <apply|reject> --reviewer <id> --approval <candidate-hash>` binds exact candidate bytes and reviewer identity. Apply rechecks project identity, the complete unchanged instruction catalog, deterministic rule path, Markdown, and plan before the existing durable apply transaction writes one Lervo-generated instruction. Reject removes the local candidate without changing repository instruction bytes.

The active candidate registry is ignored local state, sharded by content identity, limited to 64 records, and never historical authority. Apply and reject remove their candidate. If apply is interrupted after its success event but before cleanup, the exact target hash and approval digest permit recoverable cleanup without a second write. Re-intake can recreate a rejected proposal when the user explicitly requests it again.

Direct unmanaged hooks remain retrieval-only under ADR-0327. Their context tells agents to perform the explicit lifecycle as bookkeeping only when the user's request contains an explicit repository-long instruction. Hooks neither ground the effect nor create candidates. Agents do not ask users to run bookkeeping commands.

This decision supersedes only ADR-0304's automatic direct-hook materialization mechanism. Its semantic gates, deterministic generated document, provider neutrality, local-without-Hub behavior, conflict blocking, and user-owned-byte protection remain authoritative.

## State, event, privacy, and failure meaning

The new `durable-instruction candidate` local state requires candidate, project, provider, source-snapshot, request-digest, resolver-digest, plan, rule, target, proposed-content, typed-instruction, reason, and creation-time fields. Candidate status requires exact review; it is not canonical truth, provider use evidence, or approval. Registry corruption, unsafe paths, noncanonical bytes, more than 64 active candidates, or records above 16 KiB fail closed.

No event type is added. Successful apply uses `knowledge.materialization.applied` with `operation=durable_instruction_intake`, plan and source-snapshot binding, policy and compiler coordinates, hash-only approval digest, complete coverage, bounded counts, before-and-after catalog digests, and application time. It excludes the request, proposed Markdown, rule text, reviewer ID, absolute paths, provider output, credentials, and configuration. Rejection emits no success event because it creates no durable repository outcome.

Pending, ignored, workstream, current, blocked, stale-catalog, wrong-hash, wrong-project, invalid-reviewer, unsafe-state, and apply-transaction failures create no canonical instruction. A successful apply event followed by failed candidate cleanup means the instruction was applied and cleanup is recoverable; it must not be applied twice. Repository knowledge migration and lint remain the canonical registration lifecycle before completion and fresh indexed retrieval.

## Verification

- The installed CLI journey creates a candidate without creating instruction bytes or retaining the raw request.
- A wrong candidate hash cannot apply; an exact reviewed hash creates exactly the proposed deterministic Markdown and records the existing materialization event.
- Reject removes the active candidate and creates no instruction.
- Pending semantic classification creates no candidate.
- After standard knowledge migration, a fresh query retrieves the new instruction.
- Existing direct-hook regression proves zero effect-grounding calls and zero automatic materialization.
- Quality, documentation, knowledge migration, knowledge lint, package, and base-bound release-completion checks pass.

## References

- [Bounded instruction registry and semantic durable-rule intake](0304-bounded-instruction-registry-and-semantic-durable-rule-intake.md)
- [Availability-safe unmanaged terminal hooks](../../execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
- [Typed semantic request grounding](../../../specifications/execution/semantic-grounding.md)
- [Knowledge materialization](../../../specifications/execution/events-and-privacy/knowledge-and-terminal-integration/knowledge-materialization.md)
