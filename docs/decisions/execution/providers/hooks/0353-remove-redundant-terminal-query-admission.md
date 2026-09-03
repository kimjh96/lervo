# ADR-0353: Remove redundant terminal query admission

Status: `accepted`  
Date: 2026-09-03

## Context

A real Codex `UserPromptSubmit` observation took 18,563.947 milliseconds. The stage then
named `projection_admission` accounted for 14,526.218 milliseconds, while corpus
preparation took 1,861.995 milliseconds, repository snapshotting took 709.298
milliseconds, and search took 1,338.969 milliseconds.

A privacy-safe synthetic diagnostic decomposed the provider-owned stage. The admission
turn produced no retrieval result but consumed 5,059 milliseconds and 11,185 tokens.
The following query-projection turn consumed 6,582 milliseconds and 11,351 tokens and
produced two bounded queries. Each direct hook is a new operating-system process, so the
admitted runner is closed after that one projection and cannot amortize the synthetic
turn over later prompts.

ADR-0326 introduced admission while query projection and effect grounding competed for
provider startup. ADR-0327 later removed effect grounding from unmanaged direct prompts.
The admission turn therefore no longer protects a concurrent provider operation. Codex
already performs a separate no-model-tools preflight, starts the app server with hooks,
MCP servers, and model capabilities disabled, and uses a fresh isolated thread for the
real projection. Claude already executes each projection in a fresh serialized
no-capability process.

## Decision

Use a direct query-runner lifecycle for production terminal projection.

- Separate capability-free runner construction from synthetic model admission. Keep the
  historical admitted wrapper available only for evidence compatibility; production
  preparation opens the boundary and performs no diagnostic model turn.
- Retain the provider-neutral projector instruction, response schema, bounded context,
  digest checks, query limits, fresh Codex thread, serialized Claude process, complete
  usage receipt, close ownership, and fail-closed projection behavior.
- Bind the lifecycle correction as projector contract
  `lervo.provider-query-projector.v8`. A v7 identity cannot describe the direct
  production lifecycle and cannot be retried into v8 evidence.
- Bind the changed lifecycle as
  `codex.persistent_isolated_thread_direct.v1` and
  `claude.serialized_process_direct.v1`. These contracts produce new projector build
  identities; the admitted build identities cannot describe direct execution.
- Rename the current direct-hook timing stage to `query_projection`. Retain
  `projection_admission` in catalog version 2 for historical version 1 observations;
  current managed and terminal producers emit catalog version 2.
- The reviewed real-use report records `projectorLifecycle` with schema version 1,
  provider-bound runtime contract, mode `direct`, `preObservationModelTurns: 0`, and
  explicit request, response, and provider-output exclusions. It records no readiness
  claim. Missing lifecycle coordinates describe a historical report, not direct
  preparation.

The production projector remains behind the existing provider-neutral port. Search,
selection, loading, hook availability, and core execution do not import provider runner
details. Runner construction, optional historical admission, query projection, and
terminal timing remain separate responsibilities.

## Evaluation and promotion gate

The first one-repetition Codex v7-direct diagnostic is failed evidence: all four
projections completed within 7,198 milliseconds with complete usage, but only one of
four Lexical v2 cases passed because the active workstream no longer carried the
approved current-workstream anchors used by three frozen cases. A subsequent
five-repetition v7-direct population restored those anchors but exposed another
boundary error: seven broadly relevant workstream references consumed seven of eight
query slots. Fifteen of 20 observations passed; ADR-0318 ranked 11 or 12 in the five
failed observations. Report `lv2real_bd48bad88f9e496a8a0cf082`, hash
`sha256:1516a0173f559802b27ee1ef3f7485049f4b82f8bd4a91151643d1a4c2f8c9d1`,
is failed evidence and cannot be retried or reported as passing.

Before production qualification changes:

1. Keep only the direct lifecycle decision, ADR-0308 evaluation gate, and ADR-0318
   qualification as current-workstream references. Global repository instructions and
   linked performance specifications continue through AGENTS and knowledge resolution;
   duplicating them as retrieval anchors is neither required nor allowed. Do not add
   benchmark-only aliases, boosts, hidden paths, or expected results to provider input.
2. Freeze the resulting current Markdown corpus and workstream projection.
3. Run the unchanged four-case, five-repetition Codex population once. Run Claude once
   only after Codex passes. Require complete usage, zero projection failures, every
   projection within 20 seconds, and every Lexical v2 result within the unchanged rank
   gate.
4. Promote the new projector build pair into product qualification only if both exact
   populations pass. Regenerate the terminal runtime, then measure a real direct hook
   and compare the query-projection stage and observed usage with the diagnostic
   baseline without claiming a population percentile from one prompt.

The v8 populations passed on source snapshot `ksnap_dc098944e1cd0e0c31e63475`
and corpus digest
`sha256:6d30dcaaa0840b681ea527a6d161f8e090dbf7bf38156e93abc67b4a9b692a2f`.
Codex report `lv2real_203461d7bb168523d82810ad` passed 20/20 with maximum
projection 9,666 milliseconds. Claude report
`lv2real_e68a4ad6972b656fffece6ca` passed 20/20 with maximum projection 5,199
milliseconds. Both reported complete usage and zero projection failures. Product
qualification `spqual_18bb11bf0b6a01f9a33190bc` binds those exact builds, prior
product-default plan `srplan_db810188acfc08abd0b5bd4a`, and the [direct lifecycle
evidence](../../../../evidence/search/lexical-v2/terminal-direct-query-projection-v1.md).

The final regenerated runtime then produced prepared-context event
`evt_b4464529e0714074a2e1a427c3302998` and catalog version 2 stage set
`stgobs_c04657d6269f408b91de0900`. Against the preceding admitted observation, total
Lervo time fell from 18,563.947 to 15,137.624 milliseconds and the provider query stage
fell from 14,526.218 to 11,156.418 milliseconds. The direct receipt reported 11,744
tokens for its only model turn. The previous receipt reported 11,731 projection tokens
but excluded a separately measured 11,185-token admission turn. These are matched
diagnostic observations, not percentile or billing claims. The [operational
evidence](../../../../evidence/foundation/terminal-direct-query-projection-operational-v1.md)
records the exact boundary and limitations.

## Failure meaning and privacy

Runner-open or projection failure in an unmanaged direct prompt preserves ADR-0327's
empty successful hook output and creates no prepared-context claim. It does not prove a
query was selected, loaded, injected, referenced, or used. A failed reviewed population
cannot be combined, retried, or partially promoted.

The lifecycle report and stage event retain only bounded identifiers, hashes, counts,
durations, outcomes, and privacy dispositions. They exclude prompt, context, projected
query, response, reasoning, provider output, configuration, credentials, repository
content, and absolute paths. Token counts are usage measurements, never token values or
model-learning evidence.

## Verification

- Runner tests prove direct preparation performs zero model turns, preserves provider
  binding, and closes owned resources.
- Projector tests prove direct runtime identity, one projection call, provider mismatch
  rejection, close-on-success, and close-on-failure behavior.
- Schema and terminal tests prove catalog version 2 emits `query_projection` while
  historical catalog version 1 events remain readable.
- Exact reviewed Codex and Claude populations must satisfy the unchanged gate before
  product qualification changes.
- Generated runtime integrity, real-hook timing, quality, type, documentation lifecycle,
  knowledge migration and lint, release intent, package, and release-completion checks
  remain required.

## References

- [Terminal projector admission](../../../search/engines/0326-pre-admit-terminal-query-projector-under-hook-ownership.md)
- [Availability-safe terminal hooks](0327-availability-safe-unmanaged-terminal-hooks.md)
- [Product-default projected search](../../../search/engines/0328-make-qualified-lexical-v2-the-product-default.md)
- [Stage observation and performance](../../../../specifications/execution/stage-observation-and-performance.md)
- [Lexical v2 activation gates](../../../search/engines/0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [Lexical v2 qualification](../../../search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
