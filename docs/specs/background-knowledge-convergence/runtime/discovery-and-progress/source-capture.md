# Complete source capture

## Capture bounds and repository links

Default capture bounds are 20,000 paths, 64 MiB per ordinary file, and 256 MiB total. Exceeding an applicable bound requires attention, never partial success.

[ADR-0436](../../../../decisions/knowledge/repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) permits an exact reviewed delegation, through optional `sourceCapture`, to select a total capture ceiling up to 1 GiB and at most 32 reference-only repository links. Each link binds its exact relative target and kind. Targets must separately appear in the complete source inventory. Chains and escapes fail closed; links remain unchanged.

## Worksets and dispositions

Opaque descriptor capture establishes no asset acceptance. Canonical worksets must obey both reviewed document/source-byte ceilings and the existing canonical request bound, advancing a complete durable cursor.

Text review, sensitive local material, and opaque verified assets retain separate dispositions. Unread sensitive sources settle by their explicit `sensitive_local` baseline disposition; only nonsensitive opaque assets require exact typed verification ([ADR-0448](../../../../decisions/knowledge/repository/canonicalization/0448-settle-unread-sensitive-sources-by-disposition.md)).

Tracked assets must never be silently classified as generated caches. Pinned before-commits remain reviewable beyond four commits; unavailable dirty history remains explicitly unsupported.

Lervo-owned generated prefixes are excluded from complete capture, changed-path observation, baseline assessment obligations, and carried assessment inputs: `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/`. Git tracking or a missing ignore rule does not change that ownership. Historical events and existing candidate debt remain visible. User knowledge stored there needs a separate reviewed ownership correction; this exclusion never deletes or moves files ([ADR-0532](../../../../decisions/knowledge/maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md)).
