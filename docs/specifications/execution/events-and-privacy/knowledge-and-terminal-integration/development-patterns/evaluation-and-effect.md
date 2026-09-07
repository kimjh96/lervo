# Evaluation and effect

`development.pattern.evaluation.registered` records the exact pre-promotion protocol, plan, candidate, review, intended target, adapter, baseline-window, baseline-observation, metric, artifact, and time coordinates.

`development.pattern.effect.observed` records the exact protocol, promotion, comparison, unchanged target, adapter, treatment-window, treatment-observation, aggregate, attribution, rollback disposition, metric count, artifact, and time coordinates.

Both events exclude bodies, paths, request prose, raw samples, native IDs, user identities, credentials, and unrestricted errors.

Registration proves only that an injected adapter verified the bound baseline before promotion. Effect observation proves only the bound comparison. Attribution is always `unestablished`. `review_required` never authorizes automatic rollback or model-learning, truth, correctness, or semantic-use claims.

Invalid timing or binding, adapter drift, storage failure, or event failure creates no success event.
