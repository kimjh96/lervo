# ADR-0326: Pre-admit the terminal query projector under hook ownership

Status: `accepted for evaluation only`
Date: 2026-08-31

## Context

The final provider-query-projector v7 evaluation pair passed the frozen 462-document corpus. Codex report `lv2real_776c704c102d266d7cefa4a7` (`sha256:943182713b3883421b3b1cbc3ba8dc60f85a614e1957a80685960531468aefd9`) and Claude report `lv2real_2a9800a10fd6e1f006a45eaf` (`sha256:1459b9c165f0721b7fa5534631ed74c654039667aa49187d94b3a7f643cf2074`) each passed 20 of 20 observations with complete usage, no projection failures, and durations below 20 seconds. They bound projector builds `sqbuild_4c2f405568b9ff5c1de91332` and `sqbuild_67f6aaa4c3afeaa5a6d55acc` to corpus digest `sha256:34ef8c823c2355b9587aaa6cfcf497f53f8ba009af400d980687b529b366f96e`.

Candidate transition `srpact_4e5db97630e7e41e4a6337e5` selected bundle `srpbundle_c15983293b9ccec7f2ccf46e`. Three distinct Codex `UserPromptSubmit` observations failed closed without a prepared-context receipt. Unlike v6, every process exited normally, proving the v7 close contract. Isolated projection completed in 6–11 seconds. Terminal grounding timed out after about 21 seconds or returned an invalid proposal after about 17 seconds; both became abstentions. Concurrent grounding and query-runner admission exceeded projection's 20-second bound under provider startup contention.

A diagnostic admitting the query runner first completed admission, parallel grounding and projection, and closure in 23.7 seconds; projection took 6.2 seconds. Transition `srpact_1915fc586b706515af4c5223` restored the baseline. The reports remain retrieval-quality evidence, but the failed terminal observations provide no operational activation evidence.

The first final-corpus pair also passed. Codex report `lv2real_d6c7942c50e3d352a33af650` (`sha256:576c2269092c911e16a222659d2a117b087b7375dc05129b4126196beb000057`) and Claude report `lv2real_148edbaeb1e3b9d49995267c` (`sha256:e9c1d53875d4869bee9547b77b99688cbd977ca1f28283324c932476eb5f8447`) each passed 20 of 20 observations on the same 463-document corpus digest `sha256:997ea78b133e60db9e8d26ddd66fe6cee0a92f46ded8e6303b92c58573acab90`. Candidate transition `srpact_bf4ff1cde14c99e2faa3c8c7` selected their bundle, but the Codex terminal inquiry failed closed after 33.27 seconds. Independent deterministic selection with the same plan, build, and corpus succeeded, excluding selection compatibility. Admission followed by concurrent grounding and projection remained bounded by grounding's 20-second budget, leaving insufficient time for corpus scanning, selection, loading, assembly, and closure within the 30-second provider hook limit. Transition `srpact_d548dd8144074e4420e86936` restored the baseline. These reports remain retrieval-quality evidence and establish no activation.

After grounding was bounded to 10 seconds, a third paired report generation passed on the final normalized corpus, and transition `srpact_f9ac9c2e51b04b7b65d9f592` selected it. The terminal inquiry reached query projection, deterministic selection, and exact-hash loading within 21.32 seconds but failed before its prepared-context receipt. Local validation found a producer/schema mismatch: `terminal.context.prepared` emitted `durableInstructionStatus`, `durableInstructionRuleId`, `durableInstructionTargetPath`, and `durableInstructionReasonIds`, but its exact-key schema did not admit that additive coordinate group. The event store correctly rejected all four as additional properties. No prompt, provider output, configuration, credential, or projected query was recorded. The candidate remains non-activated pending rollback and final schema-aligned evaluation.

Schema alignment exposed another independent boundary mismatch before any activation claim. The common nested redactor classified numeric `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, and `totalTokens` fields in `queryProjectionReceipt.usage` as credential-like and removed them. The partial usage object then failed its exact schema. These fields are bounded non-negative counts already permitted by the query-projection receipt; they contain no token values, text, names, or credentials.

## Decision

Move query-runner admission to the terminal-hook owner before terminal grounding starts.

- Retain projector contract `lervo.provider-query-projector.v7`, Codex runtime contract `codex.persistent_isolated_thread_admission.v3`, and Claude runtime contract `claude.serialized_process_admission.v2`. Query instructions, response schema, isolated-thread behavior, retrieval semantics, and projector build identities remain unchanged.
- Add a production preparation port binding one admitted query projector to one provider and exposing only projection and close operations.
- For `UserPromptSubmit`, the terminal hook must await preparation before starting grounding and projection. It must then run grounding and the admitted projection concurrently and close the owner in `finally` after selection, loading, and assembly complete or fail.
- Bound terminal semantic grounding to 10 seconds within the outer 30-second hook limit. Timeout remains a typed semantic-resolution failure producing the existing empty abstention decision. It must never turn retrieval queries into semantic truth, effects, workflow, or authority. Independently admitted query projection retains its 20-second bound.
- Add the four existing durable-instruction observation coordinates to the `terminal.context.prepared` schema as an all-or-none additive group. Status is a bounded lifecycle enum; rule ID is an opaque nullable content ID; target path is a nullable repository-relative path; reasons are bounded opaque identifiers. Historical payloads without the group remain valid. Partial groups fail validation. Missing coordinates mean unobserved, not false or successful.
- Permit only the five exact numeric query-usage count paths through nested event redaction. All other keys containing `token`, including unknown nested fields and credential material, remain redacted. The exact query-projection schema must validate the complete optional usage object or reject the event.
- `Stop` must not admit a query runner. Non-terminal callers may continue using the one-call production wrapper, which prepares, projects, and closes within one owned call.
- Provider mismatch, admission failure, projection failure, selection failure, and close failure remain fail-closed. No error path may expose the prompt, context, projected query, provider output, configuration, or credentials.

No reviewed case, expected path, maximum rank, match policy, repetition count, provider, model, effort, query limit, retrieval engine, adapter build, fusion algorithm, privacy exclusion, activation threshold, query instruction, response schema, isolated-thread behavior, retrieval semantic, or projector build identity changes.

## Activation gate

Normalize and migrate this decision and implementation, regenerate the self-contained terminal runtime, and freeze the resulting Markdown corpus. Run a new five-repetition Codex report and, only after it passes, a matching Claude report on that corpus. The reports may retain the unchanged v7 projector build identities but must use new corpus and report coordinates.

Only a new bundle containing those final-corpus reports may be activated. The selected Codex terminal inquiry must produce a prepared-context receipt and exit within the provider's 30-second hook bound. Activation also requires explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness.

## Failure meaning and privacy

Retain all five failed terminal observations as failed operational evidence; do not retry or reclassify them. Pre-admission proves only that a capability-free query runner is ready. It does not prove selection, loading, injection, reference, or provider use.

Reports and runtime receipts retain only bounded hashes, identifiers, durations, usage, counts, lifecycle dispositions, repository-relative paths, and privacy dispositions. The durable group excludes request text, normalized rule text, provider output, configuration, credentials, and reasoning.

## Verification

- Focused tests must prove `prepare → project → close`, provider binding, closure on success and failure, and no query admission for `Stop`.
- Grounding tests must prove the 10-second inner budget and unchanged typed abstention on provider failure.
- Schema tests must accept the complete durable-instruction group, reject every partial group, and continue accepting historical payloads without the group.
- Redaction tests must retain the five numeric usage counts while removing unknown token-like fields and provider text.
- The generated runtime must contain the pre-admission lifecycle and pass integrity verification.
- Fresh paired reports must pass the unchanged reviewed suite on one final corpus without retries.
- A selected terminal inquiry, explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness must pass.
- Quality, type, documentation lifecycle, knowledge lint, release-completion, and package checks remain required before completion.

## Consequences

Query-runner startup moves outside the concurrent terminal budget, while grounding and admitted projection remain bounded and concurrent. This changes lifecycle ownership, schema admission for the complete durable-instruction group, and narrowly scoped numeric usage redaction. It does not activate the candidate or convert retrieval and failed observations into semantic or operational evidence.

## References

- [Owned v7 lifecycle](0325-pre-register-provider-query-projector-v7-owned-lifecycle.md)
- [Typed terminal grounding](../../execution/grounding/0237-typed-semantic-grounding-and-terminal-stage-evidence.md)
- [Self-contained terminal runtime](../../execution/providers/0204-self-contained-repository-terminal-hook-runtime.md)
- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
