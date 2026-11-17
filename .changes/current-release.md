<!-- lervo-release package="@lervo/cli" version="0.24.1" schema="1" -->

## What's changed

- Admit lervo upgrade ahead of waiting background knowledge cycles, and stop a running cycle at its next stage boundary while an upgrade waits.
- Restart the repository replica coordinator during lervo upgrade when its running process did not load the runtime current names, and report it as repository_replica_service_stale_runtime on macOS and Linux.
- Stop the provider source poll before a knowledge review records its observation, so no source check runs between the exact fence and the effects it guards.
