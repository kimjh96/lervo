# Native repository work on the Node

## Provider execution and continuity

Natural `repository_work` intent runs a native repository turn on the Node. `command.provider` selects Codex or Claude; matching `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` values configure its CLI. Optional `routing.workTimeoutMs` bounds a turn from 10 seconds through 30 minutes and defaults to 15 minutes.

A completed conversation or thread resumes the same opaque provider session for that hired agent. Exact duplicate requests coalesce while active and reuse the recent result instead of running twice.

The runtime prepends its own Node executable directory to the provider process `PATH`, allowing an absolute Codex launcher using `#!/usr/bin/env node` to work under a minimal systemd environment. Codex receives the exact Git common directory as an additional repository-owned writable root so `.git` sandbox protection does not block Lervo workstream bookkeeping.

A message-scoped provider or dispatch failure follows the durable interaction failure path without stopping other configured Discord identities.

## Replica parity and completion

Top-level `repositoryReplica` makes exact peer parity mandatory for native work. `required` must be `true`. `maximumStalenessMs`, `waitTimeoutMs`, and `pollIntervalMs` bound the readiness receipt, total wait, and recheck interval, respectively. The external replica coordinator must be installed separately with its owner-only peer configuration.

A changed turn is not published as successful until the peer receipt reaches the new exact snapshot and the workstream, terminal canonicalization declaration, and repository knowledge lifecycle are current.

## Execution and evidence boundaries

Native work may inspect and change repository bytes. Its execution instructions exclude commits, pushes, publication, deployment, broad deletion, and secret disclosure. These exclusions are policy instructions rather than an operating-system sandbox guarantee.

The result reports Git-observed changed paths and does not claim exact-path managed-run verification. Fixed queue text is never used for native work.
