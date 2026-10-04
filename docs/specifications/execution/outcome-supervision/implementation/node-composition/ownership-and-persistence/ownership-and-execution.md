# Ownership and execution

## Owner lifecycle

Each cycle holds one repository-owned lease while reading pending decisions, recording decisions, executing effects, and recording receipts. Inspect unresolved old-source effects before replacement planning. A session cannot be used after its owner operation settles. Closing waits for that operation before releasing storage.

Leases last five minutes. Explicit renewal requires pending journal writes to settle first and invalidates prior fence coordinates. Expiry alone never authorizes abandoned-owner takeover.

New leases hold a separate SQLite transaction throughout the owner operation. This operating-system lock serializes owner operations for one supervision identity and releases when its process dies. Different supervision identities retain independent ownership. Worker processes can still observe and commit the current private lease token through the separate lease database.

After the owner operation and its started effects settle, release closes the process lock inside the durable lease transaction before recording `released = 1`. A reported lock-close failure rolls back that record. The lock handle remains available for a later close attempt; expiry alone remains insufficient to claim ownership.

## Recovery and private protocol

Recovery acquires the process lock and binds a new token and generation before inspecting unresolved effects, without waiting for the former lease to expire.

The private `sop1:` token protocol records the token and lock-file device/inode identity in one row per supervisor, within the existing 4,096-supervisor bound. A private directory contains at most 4,096 hashed lock files, including orphan files left by interrupted acquisition. The lease transaction serializes allocation. Capacity exhaustion fails closed and requires explicit reconciliation before another identity can acquire ownership.

Neither tokens nor file identities enter public events or diagnostics. Missing protocol evidence, replaced or unsafe lock files, and unreleased legacy leases cannot establish recovery. The six-column lease table remains readable by older writers.

Recovery invalidates the former token but proves neither descendant-process termination nor effect completion, usage, or acceptance. Pending requests and reservations retain their existing uncertainty.

## Execution authority

The execution adapter receives synchronous commit fencing and explicit renewal. These protect storage ownership, not effect permission. The adapter must derive admission from the actual effect payload, revalidate authority at its own commit boundary, and settle all started effects before returning. The factory performs another fresh policy review immediately before invoking the adapter.

## Identity continuity

A workstream retains one supervision identity throughout mandate succession, including after revocation. Installation checks project history inside the event append transaction, preventing a second journal or database connection from resetting ownership or designated-host ancestry by choosing another ID. Current authority observations reject conflicting historical identities. This adds no polling loop or new persistent registry.
