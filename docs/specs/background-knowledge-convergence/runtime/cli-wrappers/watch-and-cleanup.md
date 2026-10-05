# Watch output and cleanup limits

Watch opens storage and starts the autonomous worker. Cycle callbacks print JSON. Failure callbacks write one line through `knowledgeWorkerFailureLine`:

- The code must match `^[a-z][a-z0-9_]{0,63}$`; otherwise it becomes `knowledge_job_transient_failure`.
- A `RepositoryKnowledgeError` or `KnowledgeConvergenceRuntimeError` adds its message in parentheses, limited to 300 characters on one line, with the repository root replaced by `.`.
- Native and provider errors stay code-only.

The line goes to the owner-only worker log and may name a repository-relative path, such as the source that changed during a scan ([ADR-0465](../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)).

After startup, the wrapper waits for SIGINT or SIGTERM. The signal handler removes both registered listeners and resolves the wait. The intended finally cleanup sequence is to await `stop()`, then await `storage.close()`.

Two failure paths limit cleanup:

- `startAutonomousKnowledgeWorker` runs before the cleanup try/finally. A synchronous startup exception leaves opened storage without a closure attempt here.
- In finally, rejection of `stop()` prevents the subsequent `storage.close()` call.

The outer catch reports failure and returns one, with no additional cleanup path.
