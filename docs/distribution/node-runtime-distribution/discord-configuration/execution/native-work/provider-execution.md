# Provider execution and continuity

`command.provider` selects Codex or Claude for native repository work. Matching `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` values configure its CLI. Optional `routing.workTimeoutMs` bounds a turn from 10 seconds through 30 minutes; the default is 15 minutes.

A completed conversation or thread resumes the same opaque provider session for that hired agent. Exact duplicate requests coalesce while active and reuse the recent result instead of running twice.

The runtime prepends its Node executable directory to the provider process `PATH`, allowing an absolute Codex launcher using `#!/usr/bin/env node` to work under a minimal systemd environment. Codex receives the exact Git common directory as an additional repository-owned writable root so `.git` sandbox protection does not block Lervo workstream bookkeeping.

A message-scoped provider or dispatch failure follows the durable interaction failure path without stopping other configured Discord identities.
