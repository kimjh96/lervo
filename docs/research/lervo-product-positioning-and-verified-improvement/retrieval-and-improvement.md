# Repository retrieval and verified improvement

## Existing request-aware repository retrieval

Lervo already finds repository documents that fit a natural-language request. It projects a request into bounded queries, retrieves only registered current-repository knowledge, ranks and selects candidates, loads exact current bytes, and prepares bounded context for a managed adapter or direct terminal hook.

```text
natural-language request
  -> provider-neutral query projection
  -> qualified current-repository retrieval
  -> bounded candidate ranking and selection
  -> exact-hash load
  -> managed delivery or unmanaged hook preparation
```

This implemented capability is outside the proposed future improvement scope. Its evidence language remains narrow:

- Discovery does not prove selection.
- Selection does not prove loading.
- Loading does not prove provider injection.
- Injection or hook preparation does not prove reference, understanding, correctness, or semantic use.
- An empty current-repository result says nothing about another repository or external service.

Future refinement should measure missed relevant sources, unnecessary selected sources, exact output references, and downstream task outcomes. These observations must not become an unsupported claim that the model used the right document.

## Improvement is not model self-learning

The phrases `the model learns by itself` and `the model correctly learned` are invalid descriptions of Lervo:

1. Lervo does not update provider model weights.
2. Remembering or repeating an agent's output cannot make it canonical.
3. Correctness requires source responsibility, current repository state, review, verification, and bounded outcome evidence.
4. A stored memory, generated summary, repeated proposal, or provider agreement is not semantic truth.

The existing canonicalization assessment and development-pattern lifecycle own durable improvement. A repository-changing result can be assessed against its responsible canonical target. Reusable patterns become source-bound candidates and pass through exact review and promotion; they never modify user-owned canonical content solely because an agent proposed them.

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

The first five transitions reuse existing Lervo contracts. The version-1 verified-effect contract pre-registers a baseline and compares observable source recall, unnecessary context, verification success, repeated failure, rework, and user correction after exact promotion. Attribution remains unestablished. Unfavorable evidence requests review rather than automatic rollback.

A bounded production local adapter measures exact repository-wide verification success from canonical completion events. Metrics without defined local evidence remain unavailable; stronger causal designs remain future work.

## Safety boundaries

- Do not introduce a second knowledge authority alongside canonical repository sources.
- Do not automatically promote personal memory, conversation summaries, or agent-authored skills into repository truth.
- Do not infer semantic use, understanding, or correctness from context delivery.
- Do not let natural language, repeated approval, a mention, or room membership expand filesystem, network, provider, budget, or write authority.
- Do not couple core evidence or improvement contracts to Prime Agent, Hermes, Codex, Claude, Paperclip, Buzz, or any other product.
- Do not freeze a current model, agent pattern, protocol, retrieval method, or AI trend into the core when a versioned port and reviewed adapter can preserve replacement.
- Do not obscure unmanaged work behind managed-sounding product language.
