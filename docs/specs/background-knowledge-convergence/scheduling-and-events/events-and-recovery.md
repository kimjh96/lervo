# Events, failure, and compatibility

## Proposed event contracts

These events require schema implementation and reader-first activation; they are not currently emitted. All use the canonical project/event/run/session envelope and exclude source paths, source or candidate bodies, prompts, credentials, reviewer names, absolute paths, and raw provider errors.

| Event | Required payload fields | Meaning and failure boundary |
| --- | --- | --- |
| `repository.knowledge.baseline.requested` | Obligation ID, source snapshot ID/hash, policy hash, debt digest, delegation hash or null, counts by debt kind, requested-at | A complete baseline was captured and its job atomically queued; this proves neither review nor currency. |
| `repository.knowledge.stage.recorded` | Obligation ID, predecessor event/hash, stage, state, source snapshot hash, assignment/lease generation, attempt count, input/result artifact hashes or null, next obligation ID or dependency hash or null, normalized failure or null, occurred-at | A bounded stage outcome and handoff are durable; uncertain effects use recovery state. |
| `repository.knowledge.convergence.recorded` | Obligation ID, original source/resolution event/hash, scope (`change` or `baseline`), terminal state, source snapshot hash, canonical disposition digest, normalization coverage digest, lifecycle receipt digest, knowledge snapshot hash or null, successor ID or null, failure code or null, resolved-at | `current` requires complete exact scope verification; supersession and attention are not success. |

Private CAS artifacts hold exact manifests, semantic rationales, candidates, approvals, and stage receipts under existing owner-only controls. Events reference their hashes. Retain artifacts while any active obligation or canonical receipt references them.

Keep at most 1,024 acknowledged scheduling rows for seven days; prune only rows with inspectable canonical outcomes. Current projections replace old generations. Bounded paged rebuild does not require retained queue history.

## Failure and cancellation

Add provider-neutral codes for `knowledge_continuation_missing`, `canonicalization_candidate_missing`, `review_context_stale`, `review_context_unavailable`, `knowledge_authority_unavailable`, `knowledge_source_kind_unsupported`, `knowledge_provider_paused`, and `knowledge_effect_uncertain`.

Every local failure includes obligation/stage identity, attempt, observation digest, owner, and retry/dependency coordinates. Existing source/usage/budget codes retain their meanings.

Cancelling the original product request stops its product assignments but does not erase observed repository debt. Revoking convergence delegation prevents new calls and writes, aborts capability-free generation where supported, and reconciles any in-flight journal before reporting stopped. A new user request cannot silently restore revoked authority.

## Compatibility

Add these contracts to a new event-reader version; do not silently extend a deployed version. Deploy compatible CLI, Node, Hub, terminal-hook, and replay readers first, then activate writers through the existing exact reviewed transition. Legacy events and outcomes retain their meaning.

Rebuild baseline and continuation projections before enabling authorized background integration on one canary repository.
