# Legacy normalization candidate preparation

`apps/node-runtime/src/conversation-normalization-candidate.ts` first inspects pending documents. Inspection errors become zero pending documents, which cannot establish actual currency. Stored candidates are considered newest first by modification time, limited to four IDs. A candidate is returned only when planning produces a nonempty `review_required` result; loading or planning errors are skipped.

When pending documents lack a reviewable candidate, generation starts only for selected writer versions below 4. Version 4 or later suppresses this legacy generation trigger but still permits returning an existing reviewable candidate. This method has no independent startup or periodic trigger.

Generation runs outside the provider sandbox with one active promise, an abort signal, an eight-provider-call ceiling per compilation request, and at most four compilation attempts. The eight-call ceiling is not an aggregate bound across retries.

Preflight selects a leading subset of pending paths, excluding process-local skipped paths, and halves its size until ready. A named rejected output is skipped; an unnamed single-path failure skips that path; other failures shrink the batch. The skipped set survives subsequent calls in the same process, not restarts.

Successful compilation stores a candidate without approving or applying it. Failure logging takes at most 400 characters of an error-derived message. Shutdown aborts generation and awaits its active promise within the preparer. The responder's close method invokes that asynchronous close without awaiting it, so this call site alone does not prove generation drained before store closure.
