# Observation and source cache

## One observation per full cycle

`processKnowledgeConvergence` replays canonical convergence history once per event head and reuses the projection for discovery, dependency resumption, outbox reconciliation and status. Any append forces a fresh replay.

When no delivery was claimed and the event head is unchanged, closing status reuses the opening baseline. The runtime host reuses a discovered baseline for later dependency checks while the repository digest and event head remain unchanged.

Baseline discovery captures source bytes once, bracketing capture with the repository digest. It reports `source_bytes_changed` when the digest moved. `inspectRepositoryKnowledgeCurrency` accepts the already prepared knowledge scan. `snapshotHash`, `policyHash`, `debtDigest` and every event payload are computed exactly as before.

## Private source hash cache

`.lervo/state/knowledge/source-hash-cache.sqlite` has one table: `sources(path, size, mtime_ns, ctime_ns, ino, hashed_at_ns, sha256, kind)`. Complete captures consult it for ordinary files. Symbolic references are never cached.

A hit requires an exact `(path, size, mtimeNs, ctimeNs, ino)` match. Entries whose modification or change time falls within two seconds before hashing are rejected as racy. Misses read through the same no-follow checks, then hash and upsert the result.

Each complete capture prunes absent paths. The table holds at most 50,000 rows and is cleared when it exceeds that bound. The `ctimeNs` key extends the ADR's `(path, size, mtimeNs, ino)` so a same-size rewrite followed by restoring `mtime` still misses.

Source paths already appear in private baselines. The cache holds hashes but no bodies, uses mode `0600`, and is never tracked.

An unreadable or corrupt database is deleted and rebuilt once, then bypassed for that capture. Cache failure never changes capture output: cached and uncached output is byte-identical.
