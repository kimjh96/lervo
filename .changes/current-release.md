<!-- lervo-release package="@lervo/cli" version="0.59.1" schema="1" -->

## What's changed

- A host whose delegated providers are all unadmitted, such as a logged-out Claude CLI, yields the knowledge convergence lease so a host that can do the work claims it.
- A workspace start that fails retries its rollback once when the first removal fails, and reports rollbackCause when the rollback still does not finish.
- Terminal hooks wait up to 500 ms, not 100 ms, for the context server to accept a request before running in their own process, so a server paging back in still answers.
