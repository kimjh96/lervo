# Completion reconciliation

`assignment.completion.reconciled` records the prepared-evidence and exact reconciliation command IDs, source managed run, assignment, agent, lease, result artifact coordinates, resulting revision, and time.

It excludes task and acceptance prose, paths, prompts, provider output, artifact bodies, reviewer identity, reasoning, credentials, and provider configuration.

Success means the still-matching leased assignment state and event committed together. A preparation made during the original half-open `[acquiredAt, expiresAt)` lease interval may be applied after expiry.

Another revision or lease, an out-of-interval preparation, a terminal assignment, stale plan, contention, or event failure records no reconciliation success. Event failure restores the prior assignment bytes. Missing preparation remains escalation-required and never authorizes provider rerun.
