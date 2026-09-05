# Development patterns

## Observation and transition

`development.pattern.observed` records pattern and observation IDs, provider, source-snapshot and evidence digests, independent occurrence count, and time.

`development.pattern.transitioned` records transition and pattern IDs, prior and next lifecycle states, candidate and review artifact coordinates, an optional replacement pattern ID for supersession, target kind, exact approval digest, and time.

Both exclude candidate and review bodies, occurrence and target paths, verification commands, reviewer identity, source text, credentials, and model output.

Observation proves only evidence submission, not that a convention is true or approved. Transition success means the immutable artifact or exact promotion transaction committed. Supersession proves only a reviewed lifecycle relation and never changes canonical or installed bytes. Storage or event failure records no transition, and promotion restores changed bytes.

## Evaluation and effect

`development.pattern.evaluation.registered` records the exact pre-promotion protocol, plan, candidate, review, intended target, adapter, baseline-window, baseline-observation, metric, artifact, and time coordinates.

`development.pattern.effect.observed` records the exact protocol, promotion, comparison, unchanged target, adapter, treatment-window, treatment-observation, aggregate, attribution, rollback disposition, metric count, artifact, and time coordinates.

Evaluation registration and effect observation exclude bodies, paths, request prose, raw samples, native IDs, user identities, credentials, and unrestricted errors.

Registration proves only that an injected adapter verified the bound baseline before promotion. Effect observation proves only the bound comparison; attribution is always `unestablished`, and `review_required` never authorizes automatic rollback or model-learning, truth, correctness, or semantic-use claims. Invalid timing or binding, adapter drift, storage or event failure creates no success event.
