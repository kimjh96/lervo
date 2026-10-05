# Deliberation failure and evaluation recovery

An internally exhausted elapsed budget records a canonical failed outcome; the assigned CLI returns a terminal `failed` summary with exit status 2. The queue settles that summary normally and publishes the language-matched failure consequence without classifying the known failure as uncertain.

Only outer worker expiry, process loss, or another boundary failure preventing a verified terminal summary remains uncertain exactly once and never reruns provider work. Authoritative inspection continues on the background schedule. Transient inspection, interaction-store, or delivery failure does not terminate the deliberation background loop or discard the pending attention obligation.

Semantic publication evaluation is fail-closed and separately bounded. If its read-only managed child run fails at a retry-safe snapshot or provider boundary, the runner retries the same content-addressed artifact once in a fresh session, recording attempt ordinal two under `publication_evaluation` causality. It does not regenerate the producer artifact. Invalid evaluator contracts, negative check results, capability failures, telemetry failures, and exhausted infrastructure attempts remain publication failures.
