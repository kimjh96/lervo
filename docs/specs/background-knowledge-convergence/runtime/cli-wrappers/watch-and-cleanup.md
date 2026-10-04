# Watch output and cleanup limits

Watch opens storage and starts the autonomous worker. Cycle callbacks print JSON. Failure callbacks interpolate `error.code`, falling back to `knowledge_job_transient_failure` when the code is nullish. Unlike inspection, these callbacks validate neither the code's type nor its length or syntax and do not guarantee bounded failure codes.

After startup, the wrapper waits for SIGINT or SIGTERM. The signal handler removes both registered listeners and resolves the wait. The intended cleanup sequence in finally is to await `stop()` and then await `storage.close()`.

Two failure paths limit cleanup:

- `startAutonomousKnowledgeWorker` runs before the cleanup try/finally. A synchronous startup exception leaves opened storage without a closure attempt here.
- Within finally, rejection of `stop()` prevents the subsequent `storage.close()` call.

The outer catch reports failure and returns one, with no additional cleanup path.
