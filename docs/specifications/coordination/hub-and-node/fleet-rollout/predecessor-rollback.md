# Predecessor rollback

A separate one-Node rollback plan binds an exact failed target observation to the distinct predecessor version and artifact recorded by enrollment. Its installed adapter verifies both executable artifacts, the failed service definition, registry state, and current predecessor plan before invoking the explicit local service rollback action.

Complete online readiness precedes predecessor registry commit; pre-commit failure attempts exact forward compensation.

The low-level adapter grants no signed delivery or replay authority. The [installed rollback receiver](rollback-receiver.md) adds those controls but grants no unattended delivery. Neither boundary is a Hub endpoint, Node daemon transport, or multi-Node transaction.
