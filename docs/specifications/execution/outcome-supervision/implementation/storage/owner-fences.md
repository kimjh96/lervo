# Owner fences

SQLite serializes lease acquisition, renewal, release, and synchronous journal commits using `BEGIN IMMEDIATE`, WAL, and full synchronous durability. Every commit checks supervision ID, owner, random token, generation, exact expiry coordinate, and current time. Renewal invalidates previous expiry coordinates. Release permits a new token and higher generation; delayed previous owners cannot append.

Expiry does not release ownership. Abandoned leases remain blocked across restart: elapsed time cannot prove an external effect stopped. Abandoned-owner recovery and effect cancellation require independent terminal evidence and an explicit recovery adapter; this store implements neither. Normal release is permitted only after the owner operation and all started effects settle.

Callers must retain the database in durable repository coordination storage, never an evictable projection or temporary directory.

The store retains at most 4,096 supervision identities and never discards active or expired leases to make room:

- `lease_invalid` rejects malformed input.
- `lease_lost` rejects stale or expired owners before the commit callback.
- `lease_capacity` blocks new identities or generation overflow.

Stored fields are bounded IDs, opaque tokens, generations, timestamps, and release disposition. No human task content is stored.
