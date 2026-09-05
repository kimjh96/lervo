# Completion preparation

`assignment.completion.prepared` records a content-derived evidence ID, workstream, assignment revision, agent, lease, accepted verification and writing-publication states, result artifact coordinates, and preparation time under the exact managed run and session envelope.

It excludes task and acceptance prose, paths, prompts, provider output, artifact bodies, reviewer identity, reasoning, credentials, and provider configuration.

Success means the governed adapter observed one matching passed `run.completed` event and both completion gates while the exact lease was valid. It does not mean assignment state changed.

Foreign or contradictory run history, stale coordinates, invalid timing, event failure, and historical absence create no prepared-completion claim.
