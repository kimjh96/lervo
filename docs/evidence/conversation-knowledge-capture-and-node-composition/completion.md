# Completion and replay

`apps/node-runtime/src/conversation-repository-work-completion.ts` rejects excessive changed paths. It requires a current workstream, preserves a non-null baseline workstream identity, and requires a revision advance for changed work when a baseline revision exists. Knowledge-evidence preparation failures become `repository_work_knowledge_incomplete`.

The verifier searches bounded run history for the source event's canonical completion and rejects multiple matches. Exact replay checks event schema, agent/provider identity, and the full payload before appending verified work memory. This branch does not independently reconstruct a missing generic change job.

For a new completion, generic planning requires pending mode, a supplied source manifest, and storage writer capability of at least 3. Completion, a non-null planned change, and verified work memory are appended in one event-store transaction. A null plan skips change append while still permitting completion append. This conditional atomicity does not prove that every changed completion obtained a generic obligation.

The completion event uses schema version 3 in pending mode and version 2 otherwise; event schema is distinct from the storage writer-capability check. Its payload binds:

- Request and result hashes, provider-session digest, and requested routing.
- Repository revisions, sorted changed paths, and exact workstream coordinates.
- Knowledge disposition and optional manifest coordinates.
- Checkpoint disposition, replica disposition, and completion time.

`verificationStatus: passed` is not independent proof of background knowledge currency. The replica field reflects the configured flag supplied to the verifier; the default responder owns the actual readiness waits.
