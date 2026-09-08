# Reconnect and history reconciliation

Gateway resume coordinates intentionally remain process-local. On READY or RESUMED, a Discord REST history adapter reads after the platform SQLite channel cursor before readiness is published.

A conversation-owned ingress processor orders recovered messages, reuses normal adapter and interaction handling, and advances the cursor with compare-and-set only after processing.

First installation records a current baseline instead of importing prior channel history. Existing databases seed from their newest Discord correlation. A 1,000-message startup bound fails closed rather than hiding an unbounded gap.
