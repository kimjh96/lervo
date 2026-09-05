# Validation and evidence boundaries

All [v2 payloads](payload-contracts.md) use exact top-level allowlists. Resource counter names are the only approved token-like nested keys. Schema, discriminator, arithmetic, or privacy failure prevents sync acceptance and creates no observation success.

Missing resource or stage events mean `unobserved`, not zero usage or successful stage measurement. A requested historical run without a causal event is `legacy_unlinked`; missing ancestry is never reconstructed from correlation.

Managed stage-profile persistence fails before provider startup. A direct version 1 writer skips version 2 stage evidence without blocking the hook. Direct measurement or persistence failure emits no false stage success and leaves terminal coverage partial or unavailable; it does not erase or reinterpret a valid context or turn event.

Exact observation-set duplicates are idempotent. Contradictory IDs, invalid trees, duplicate hook sets, and cross-run or cross-session joins make the projection invalid.
