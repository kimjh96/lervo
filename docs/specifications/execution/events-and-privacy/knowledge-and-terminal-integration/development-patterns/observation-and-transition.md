# Observation and transition

`development.pattern.observed` records pattern and observation IDs, provider, source-snapshot and evidence digests, independent occurrence count, and time.

`development.pattern.transitioned` records transition and pattern IDs, prior and next lifecycle states, candidate and review artifact coordinates, optional replacement pattern ID for supersession, target kind, exact approval digest, and time. Agent-profile promotion and rollback may also record predecessor artifact and content hashes and activated role ID, version, contract hash, and profile hash; they never include role bytes or paths.

Both events exclude candidate and review bodies, occurrence and target paths, verification commands, reviewer identity, source text, credentials, and model output.

Observation proves only evidence submission, not that a convention is true or approved. Transition success means the immutable artifact or exact promotion or rollback transaction committed. `rolled_back` means the exact created profile was deleted or its exact predecessor restored, and role resolution was rechecked. Supersession proves only a reviewed lifecycle relation and never changes canonical or installed bytes.

Stale profile evidence, changed targets, missing predecessor bytes, storage failure, or event failure records no transition; promotion or rollback restores changed bytes.
