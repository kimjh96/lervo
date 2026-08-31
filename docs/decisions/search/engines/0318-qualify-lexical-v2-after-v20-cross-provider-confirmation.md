# ADR-0318: Qualify lexical-v2 after v20 cross-provider confirmation

Status: accepted
Date: 2026-08-31

## Context

ADR-0317 preregistered a five-repetition v20 confirmation after the three-repetition v19 Codex result failed the unchanged duration gate because one candidate observation took 39.603 seconds. It prohibited deleting, trimming, retrying, or replacing observations and required fresh Codex and Claude reports from one frozen repository state.

Both v20 reports passed every unchanged gate. They bind suite digest `sha256:dea2fda6a941ea83c661d10aa032c10dbd5ad795ee82365204272dc390f8bbe9`, corpus digest `sha256:1651c62c38d9f2c1a337ee35fd502e5fd182a26a30d0ac1df17ac9fefc0d06e1`, and repository head `a57125d2d4a7d0f3aa8a9608c70f626fd7ec97c2`. Each provider completed 120 independent arm observations without retries.

The checked-in provider cases remain `verification_authored` and `pending_human_review`. This evidence can establish that the engineering gates passed, but it cannot impersonate the authorized human review and repository-specific immutable transition required by ADR-0060.

## Decision

Qualify frozen lexical-v2 build `sebuild_e9f2ac9398b0f58d03143e7a` for activation review. This supersedes ADR-0309's evaluation-only disposition for the newer build but does not rewrite or invalidate the rejected v12 evidence.

The qualification means:

- the deterministic adapter and bounded evidence pipeline passed the preregistered local, provider-free, Codex, and Claude engineering gates;
- `lexical-v2` remains a statically registered candidate available to the existing comparison and replay machinery;
- an authorized reviewer may now assess the cases and evidence without changing thresholds or implementation;
- a repository may select the candidate only through its own comparison bundle, adoption review, activation policy, and immutable transition;
- absence of such a transition continues to resolve to `lexical-v1`, and explicit rollback continues to restore `lexical-v1` locally.

Do not change the implicit default, synthesize a review, fabricate a repository corpus, or create an activation transition in a repository with no reviewed operational search cases. Registration and engineering qualification prove neither `selected`, `loaded`, `injected`, nor `used`.

## Evidence

Codex report SHA-256 `f7303d563979300d7f292c6cd96af5322e2e2650f6f3d8f17931d6001db04eae` passed with 60/60 candidate observations, all 12 cases passing every repetition, 100% recall, 97.5% precision, 79.24% of baseline tokens, 93.22% of baseline duration, and 27.51% of baseline injected bytes.

Claude report SHA-256 `2ab6fb9eeec5d8ac11a8afde1c495d942e9f72c52a3a2194d0c35a88ee348717` passed with 60/60 candidate observations, all 12 cases passing every repetition, 100% recall, 90.83% precision, 50.37% of baseline tokens, 81.20% of baseline duration, and 27.51% of baseline injected bytes.

Both reports had complete usage and provider-preparation observations, native structured output on every observation, and zero provider errors, contract failures, tool calls, or command signals. The full chronology, local results, privacy boundary, and retained failures are recorded in the [v20 confirmation](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md).

## Consequences

Lervo now has an activation-review-eligible local successor without coupling core execution to Codex or Claude. Provider-specific warm admission remains outside search adapters. External-only replacement, augmentation, and reranking remain separately installable plan candidates under ADR-0306; this decision does not authorize an external target, credential, network call, corpus export, or dynamic package loading.

The source worktree currently has no registered operational search corpus or reviewed search cases, so manufacturing a local transition here would weaken rather than complete the activation contract. Operational retrieval therefore remains `lexical-v1` until a real repository completes the existing chain.

## Related decisions

- [Policy-bound selection](../0060-policy-bound-search-engine-selection.md)
- [Fail-closed operational resolution](../0061-fail-closed-operational-search-engine-resolution.md)
- [Replacement and composition](0306-separate-search-engine-replacement-and-composition.md)
- [V12 rejection](0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
- [V20 preregistration](0317-pre-register-lexical-v2-v20-five-repetition-confirmation.md)
