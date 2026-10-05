# Owner-only file source

The bootstrap adapter binds exact credential IDs to runtime-private paths in an immutable in-memory snapshot. It performs bounded, no-follow, owner-only reads, clears its raw buffer, and exposes only the returned byte array to the delivery contract.

It does not issue credentials, persist bindings, activate or reload a Node, select an external secret authority, or add source coordinates to organization records.
