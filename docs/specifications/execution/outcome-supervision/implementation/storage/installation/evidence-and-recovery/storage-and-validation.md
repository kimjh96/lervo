# Storage bounds and validation

The repository lease factory uses the owner-only durable coordination home shared by sibling worktrees, rather than `.lervo/state`. It rejects unsafe files and SQLite sidecars. Separate owner-only process-lock files accompany the lease database, bounded at 4,096 files including interrupted allocations. Its private protocol table retains at most one record per supervisor.

Existing bounds of 4,096 supervisor leases and 4,096 stream events apply. Retained-history compaction remains required before those boundaries can be crossed. Legacy abandoned owners and unresolved effects still require their own reconciliation evidence.

Tests exercise CLI installation and reopening, reviewer and source rejection, scope overflow, successor ordering, suspended-owner revocation, shared-lease conflicts, lost fencing after CAS writes, and lower-version writer rejection. These tests install no production mandate, autonomous hiring loop, or Node supervision deployment.
