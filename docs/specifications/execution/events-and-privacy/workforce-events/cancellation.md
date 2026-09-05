# Cancellation

`assignment.cancelled` records the opaque assignment ID, previous status, reason (`requested` or `dependency_cancelled`), exact cancellation plan ID, direct cancelled dependency IDs, resulting revision, and time. It excludes task and acceptance prose, paths, lease sessions, provider output, prompts, reasoning, credentials, and actor identity.

Success means one queued or blocked assignment state and its event committed together. Plan drift, terminal state, leased work, missing dependency evidence, contention, or event failure records no cancellation success. Event failure restores the prior assignment bytes.
