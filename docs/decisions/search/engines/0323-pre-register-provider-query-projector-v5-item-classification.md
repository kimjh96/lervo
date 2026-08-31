# ADR-0323: Pre-register provider-query-projector v5 item classification

Status: `accepted for evaluation only`  
Date: 2026-08-31

## Context

ADR-0322 introduced provider-native admission and isolated Codex app-server threads. Its fresh Codex report `lv2real_2d2321f9204db9779aa39669`, hash `sha256:4fec4d8356b1a89b204fb895c5dd6323277e0ead1246ff5a3bd5617ca5f74701`, bound projector build `sqbuild_fdce6494ecbb1dc35f5d7477`, admission `pqadm_e7388a9bf7faad5be22407e7`, and the 459-document corpus digest `sha256:ee4256a62967d542eac3211ed68325c0b17f033bec703e37b795ab76012c8804`. Admission succeeded, but only four of 20 reviewed observations completed. The other 16 failed because the runner classified a completed Codex `reasoning` item as capability-bearing. The four completed observations passed every lexical-v2 quality and duration gate. The report remains failed evidence and cannot be retried or partially accepted.

The generated Codex app-server protocol distinguishes `reasoning` from capability-bearing `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, and `collabAgentToolCall` items. Reasoning is provider computation metadata, not a command, tool call, file mutation, external effect, or authority observation. Projection does not require retaining or exposing its text.

## Decision

Create provider-query-projector v5 before another reviewed provider call.

- Codex may complete only `userMessage`, `reasoning`, and `agentMessage` items. The runner ignores user and reasoning content and parses only the final agent message through the existing native response schema.
- Any capability-bearing item or unknown item type fails the observation closed. Existing command, file, MCP, dynamic-tool, collaboration, browser, plugin, app, hook, and subagent restrictions remain unchanged.
- Bind this behavior as runtime contract `codex.persistent_isolated_thread_admission.v2` and projector contract `lervo.provider-query-projector.v5`. V4 identities cannot satisfy a v5 review.
- Preserve one synthetic admission followed by one new thread and turn per reviewed observation. Admission remains outside observation duration, and no observation is retried.
- Claude retains `claude.serialized_process_admission.v1`; the v5 projector contract still gives its fresh report a new build identity.

No reviewed case, query, expected path, rank bound, repetition count, provider, model, effort, response schema, timeout, corpus rule, retrieval stage, fusion rule, privacy exclusion, or activation threshold changes.

## Activation gate

Run Codex first on the unchanged four-case suite with five repetitions. Run Claude only if all 20 Codex observations pass. Both reports must bind the same current Markdown corpus, report complete usage, contain zero projection failures, keep every projection within 20 seconds, and pass every lexical-v2 rank check. Only the resulting v5 pair may populate the ADR-0321 review and activation bundle.

The v3 overload report and v4 item-classification report remain diagnostic failures. They cannot be combined with v5 or used to replace a v5 observation.

## Failure meaning and privacy

`provider_query_projection_failed` continues to mean the bounded provider result could not be accepted. A capability-bearing or unknown item establishes no selected, loaded, injected, referenced, or used source and invalidates the complete provider population.

The runner retains no reasoning, request, response, prompt, projected-query, context, configuration, credential, repository-content, or provider-output text. Existing receipts retain only bounded identifiers, status, duration, normalized usage, hashes, and explicit privacy dispositions.

## Verification

- Protocol-bound tests accept reasoning followed by one agent response and reject command or unknown items.
- Focused projection tests prove that the v5 contract and v2 runtime-strategy change alter build identity.
- Fresh Codex and Claude five-repetition reports cover the unchanged reviewed suite on one corpus.
- ADR-0321 activation, selected terminal retrieval, explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness must all pass.
- Quality, type, documentation lifecycle, knowledge lint, release-completion, and package checks remain required before completion.

## References

- [V4 admission](0322-pre-register-provider-query-projector-v4-admission.md)
- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Reviewed real-use suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
- [Reviewed real-use evidence](../../../evidence/search/lexical-v2/lexical-v2-reviewed-real-use-projection-v1.md)
