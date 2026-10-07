# ADR-0448: Settle unread sensitive sources by disposition

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0438](0438-bind-bounded-asset-manifests-to-delegation.md) and [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md)
Amended by: [ADR-0479](../../semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md) (undeclared opaque assets are suite-bound at final verification)

## Context

Final lifecycle verification required an exact reviewed asset disposition for every opaque and sensitive source. The installed Mac delegation declared none, so 20 sensitive sources blocked Mac baseline currency. These were ordinary source and documentation files whose paths or classifications indicate possible secrets, such as `credentials.ts` and `budget-tokens.ts`.

The scanner never reads their bytes. Binding them to a reviewed content hash adds no semantic or privacy guarantee because Lervo cannot inspect changes. Every routine edit would block currency until the owner renewed the manifest.

## Decision

- Sensitive sources settle by their explicit baseline `sensitive_local` disposition. The baseline records each path, hash, and classification reason. Their bytes remain unread and excluded from provider review and semantic coverage.
- Final lifecycle verification requires an exact `opaque_verified` disposition only for opaque sources that are neither `policy_excluded` nor `sensitive_local`.
- Delegation manifests may retain `sensitive_local` entries for compatibility; these entries no longer gate currency.
- Opaque asset verification, manifest binding, and settlement fences remain unchanged.

## Failure and privacy

This decision adds no event, state, or failure code. `asset_verification_required` now means an unread, nonsensitive opaque asset lacks typed verification. Sensitive bytes are never read, sent to a provider, or counted as semantic coverage.

## Verification

A focused test must show that an unread sensitive source no longer blocks lifecycle verification and that an unverified opaque asset still returns `asset_verification_required`. Installed verification must show the Mac baseline reaching `current` with its sensitive sources unread.
