# Knowledge and terminal integration

## Product-default search qualification

`context.recommended` may include `productQualificationId` when the shipped product default selected the search engine. The value is an opaque `spqual_` content coordinate, mutually exclusive with a repository-local `selectionTransitionId` on its source search attempt. It contains no query, corpus, path, source body, provider output, or credential.

Presence proves only product-default selection of the bound engine build; historical absence means the qualification was unobserved. Invalid, missing, or mismatched qualification prevents the non-baseline attempt and recommendation from being recorded.

## Knowledge materialization

`knowledge.materialization.applied` records operation, plan and snapshot bindings, compiler, coverage, privacy-bounded counts including deletions, registry digests, validation coordinates, and time.

Canonical provider-entrypoint adoption uses `operation=instruction_canonical_adoption`; its event binds the exact approval digest and creation count but excludes CLAUDE and AGENTS paths and bodies. The local receipt may expose source and canonical content hashes. Failure before event commit restores AGENTS. An interrupted journal requires ordinary explicit recovery and emits no success event.

## State pruning

`state.pruned` records the exact prune-plan ID, policy and inventory hashes, removed-file and byte totals, bounded per-class counts, and application time. It excludes artifact paths and path digests, content hashes and bodies, source text, credentials, and recovery-journal details.

It means eligible derived bytes were detached and durable evidence committed. Event failure restores detached targets and emits no success. A crash before or after event commit leaves a recovery tombstone; explicit recovery restores bytes if the event is absent or completes cleanup if it is present.

## Development patterns

`development.pattern.observed` records pattern and observation IDs, provider, source-snapshot and evidence digests, independent occurrence count, and time.

`development.pattern.transitioned` records transition and pattern IDs, prior and next lifecycle states, candidate and review artifact coordinates, an optional replacement pattern ID for supersession, target kind, exact approval digest, and time.

Both exclude candidate and review bodies, occurrence and target paths, verification commands, reviewer identity, source text, credentials, and model output. Observation proves only evidence submission, not that a convention is true or approved. Transition success means the immutable artifact or exact promotion transaction committed. Supersession proves only a reviewed lifecycle relation and never changes canonical or installed bytes. Storage or event failure records no transition, and promotion restores changed bytes.

`development.pattern.evaluation.registered` records the exact pre-promotion protocol, plan, candidate, review, intended target, adapter, baseline-window, baseline-observation, metric, artifact, and time coordinates.

`development.pattern.effect.observed` records the exact protocol, promotion, comparison, unchanged target, adapter, treatment-window, treatment-observation, aggregate, attribution, rollback disposition, metric count, artifact, and time coordinates.

Evaluation registration and effect observation exclude bodies, paths, request prose, raw samples, native IDs, user identities, credentials, and unrestricted errors. Registration proves only that an injected adapter verified the bound baseline before promotion. Effect observation proves only the bound comparison; attribution is always `unestablished`, and `review_required` never authorizes automatic rollback or model-learning, truth, correctness, or semantic-use claims. Invalid timing or binding, adapter drift, storage or event failure creates no success event.

## Terminal integration and activation receipts

`terminal.integration.applied` records contract, providers, provider-target path digests and after-hashes, generated-runtime path digest and after-hash, approval hash, and time. It excludes prompts, bodies, raw configuration, commands, runtime bytes, credentials, absolute paths, and output. Failure rolls back and emits no success event.

Bounded provider and event activation receipts contain provider, event, result, time, and bounded hashes and counts. They prove only that the Lervo hook endpoint executed or prepared context, not that the provider launched, accepted, understood, referenced, or used it. Status labels this evidence `hook_endpoint_observed_not_provider_authorship`.

Receipt failure blocks the hook. Status validates receipts against events, distinguishes endpoint observation from readiness, and emits a provider-specific action until every required event is observed. Lervo never changes local or global hook trust.
