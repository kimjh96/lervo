# Observation and transition

`development.pattern.observed` records pattern and observation IDs, provider, source-snapshot and evidence digests, independent occurrence count, and time.

`development.pattern.transitioned` records transition and pattern IDs, prior and next lifecycle states, candidate and review artifact coordinates, optional replacement pattern ID for supersession, target kind, exact approval digest, and time.

Both exclude candidate and review bodies, occurrence and target paths, verification commands, reviewer identity, source text, credentials, and model output.

Observation proves only evidence submission, not that a convention is true or approved. Transition success means the immutable artifact or exact promotion transaction committed. Supersession proves only a reviewed lifecycle relation and never changes canonical or installed bytes. Storage or event failure records no transition, and promotion restores changed bytes.
