# Repository retrieval and verified improvement

## Existing request-aware repository retrieval

Lervo already matches repository documents to natural-language requests. It projects bounded, provider-neutral queries, retrieves only registered current-repository knowledge, ranks and selects bounded candidates, loads exact current bytes by hash, and prepares bounded context for a managed adapter or direct terminal hook.

```text
natural-language request
  -> provider-neutral query projection
  -> qualified current-repository retrieval
  -> bounded candidate ranking and selection
  -> exact-hash load
  -> managed delivery or unmanaged hook preparation
```

This implemented capability is outside the proposed future improvement scope. Evidence remains bounded:

- Discovery does not prove selection.
- Selection does not prove loading.
- Loading does not prove provider injection.
- Injection or hook preparation does not prove reference, understanding, correctness, or semantic use.
- An empty current-repository result says nothing about another repository or external service.

Future refinement should measure missed relevant sources, unnecessary selected sources, exact output references, and downstream task outcomes without claiming that the model used the right document.

## Evidence-bound improvement

`the model learns by itself` and `the model correctly learned` are invalid descriptions of Lervo:

1. Lervo does not update provider model weights.
2. Remembering or repeating an agent's output cannot make it canonical.
3. Correctness requires source responsibility, current repository state, review, verification, and bounded outcome evidence.
4. Stored memory, generated summaries, repeated proposals, and provider agreement are not semantic truth.

Existing canonicalization assessment and the development-pattern lifecycle own durable improvement. Repository-changing results can be assessed against their responsible canonical targets. Reusable patterns become source-bound candidates requiring exact review and promotion; agent proposals alone never modify user-owned canonical content.

The product term is **evidence-bound improvement**, expressed as a **verified improvement loop**:

```text
task observation
  -> scoped improvement or canonicalization candidate
  -> provenance, conflict, ownership, and verification review
  -> promote, reject, defer, or supersede
  -> canonical repository source
  -> knowledge refresh and later retrieval
  -> bounded post-promotion effect observation
```

The first five transitions reuse existing Lervo contracts. The version-1 verified-effect contract pre-registers a baseline and compares observable source recall, unnecessary context, verification success, repeated failure, rework, and user correction after exact promotion. Attribution remains unestablished. Unfavorable evidence requests review, not automatic rollback.

A bounded production local adapter measures exact repository-wide verification success from canonical completion events. Metrics lacking defined local evidence remain unavailable; stronger causal designs remain future work.

## Safety boundaries

- Keep canonical repository sources as the sole knowledge authority.
- Do not automatically promote personal memory, conversation summaries, or agent-authored skills into repository truth.
- Do not infer semantic use, understanding, or correctness from context delivery.
- Natural language, repeated approval, mentions, and room membership must not expand filesystem, network, provider, budget, or write authority.
- Do not couple core evidence or improvement contracts to Prime Agent, Hermes, Codex, Claude, Paperclip, Buzz, or any other product.
- Do not freeze a current model, agent pattern, protocol, retrieval method, or AI trend into the core when a versioned port and reviewed adapter can preserve replacement.
- Do not obscure unmanaged work with managed-sounding product language.
