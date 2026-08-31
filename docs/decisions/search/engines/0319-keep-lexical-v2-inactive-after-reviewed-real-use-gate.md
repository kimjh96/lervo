# ADR-0319: Keep lexical-v2 inactive after the reviewed real-use gate

Status: `accepted`
Date: 2026-08-31

## Context

ADR-0318 qualified frozen build `sebuild_e9f2ac9398b0f58d03143e7a` for activation review using verification-authored cases. The repository still lacked reviewed operational cases and a registered document corpus. The user then approved four exact Korean real-use queries and expected paths under binding `sha256:ab432bcd3e9591b7dd94879ca6e8e7a314b4d6c7ae2cead153bf61512667be1d`.

The approved suite is stored at `benchmarks/search/lexical-v2-real-use-reviewed-v1.json`. Its query text is repository-owner-readable and excluded from telemetry. All four cases use `matchPolicy=all`, retain maximum rank 10, and must remain together without deletion or replacement.

The 451-document, 1,836,790-byte repository corpus exposed a gap hidden by the verification-authored suite. Raw real-use queries produced no candidate wins. A diagnostic query-projection run supplied the bounded current workstream to both provider adapters. Flattening the final projections into the existing single-query engine boundary produced these lexical-v2 expected-source ranks:

- Codex: external extensibility `3,1`; cross-provider quality `1`; raise-v2 `22,24`; no-gate-weakening `13`.
- Claude: external extensibility `4,1`; cross-provider quality `8`; raise-v2 `19,3`; no-gate-weakening `4`.

Codex passed two of four reviewed cases and Claude passed three of four. Both failed the required all-case gate. These direct-provider observations are unmanaged diagnostics, not activation evidence.

## Decision

Keep operational selection at `lexical-v1`. Do not create a comparison review, policy, or immutable transition for lexical-v2 from the current evidence. ADR-0318 remains an engineering qualification, but the reviewed real-use gate is the stronger repository-specific constraint.

Do not add Korean-to-English aliases, query-specific terms, expected-path boosts, category routing, threshold changes, case deletion, or a special fallback inside lexical-v2. The failure is at the boundary between context-sensitive natural language and deterministic retrieval, not evidence that BM25F should own semantic interpretation.

Extend the ADR-0306 composition model conceptually to:

```text
0..1 query-projection stage -> 1..3 retrieve stages -> 0..1 fusion stage -> 0..1 rerank stage
```

Query projection is a separately versioned, observable stage. It may emit at most eight bounded retrieval queries from the current request and bounded context. It establishes no workflow, effect, authority, relevance, or truth. A future activation candidate must bind request and context digests, projector adapter and build, requested retrieval language, projected-query digest and count, duration, status, and privacy disposition. Canonical telemetry excludes request, context, and projected-query text.

The direct terminal path now supplies at most 8 KiB of the verified current-workstream projection to semantic grounding. A valid provider proposal may drive read-only candidate retrieval even when effect grounding returns `clarify`, `abstain`, or `approval_required`; execution and authority remain fail-closed. A provider or contract failure returns no projected query and performs no candidate search. Exact workstream references may be preserved as candidate coordinates, but never as truth or activation authority.

This terminal correction does not connect query projection to `SearchEnginePort`, create an operational corpus, or select lexical-v2. A future retrieval-plan implementation must compare the complete projection-plus-retrieval plan against the baseline with all four reviewed cases, both providers, unchanged latency and token gates, stage receipts, explicit failure behavior, and rollback proof.

External-only retrieval, local-plus-external augmentation, and external reranking remain distinct complete plans. Query projection cannot select a plan, adapter, endpoint, credential, or environment target. Required-stage failure remains fail-closed; a reduced plan must be separately reviewed rather than silently substituted.

## New state and failure meaning

- `query_projection_missing` is the terminal selection disposition when validated grounding produced neither a projected query nor a searchable typed subject. It contains no query text and causes no search.
- A non-ready effect-grounding status no longer discards an otherwise valid read-only projection. `selectionStatus` still records only whether candidates were selected; it does not prove loading, injection, relevance, correctness, or use.
- Current-workstream context is bounded to 8 KiB, treated as untrusted provider input, and retained in no terminal event. Existing request and query digests remain the privacy-bounded event coordinates.
- A copied protocol coordinate is accepted only when its exact validated value occurs in the bounded request, prior turns, workstream context, or pending-authority coordinates. It confers no authority.

## Consequences

The repository gains exact human-reviewed real-use ground truth and fixes a context-loss boundary without claiming lexical-v2 passed. The default remains safe and local. A future candidate can combine a provider-neutral projection port with local, external-only, or composed retrieval without coupling core search to Codex or Claude.

Operational activation still requires a reviewed registered corpus, a complete plan comparison with all four cases passing, immutable review and policy evidence, controlled rollout, and explicit rollback. No current observation satisfies that chain.

## Related decisions

- [Reviewed search cases](../0055-reviewed-search-evaluation-cases.md)
- [Policy-bound selection](../0060-policy-bound-search-engine-selection.md)
- [Replacement and composition](0306-separate-search-engine-replacement-and-composition.md)
- [V20 engineering qualification](0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Typed semantic grounding](../../execution/grounding/0237-typed-semantic-grounding-and-terminal-stage-evidence.md)
