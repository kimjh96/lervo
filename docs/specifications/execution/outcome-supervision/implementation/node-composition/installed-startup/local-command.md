# Local supervision command

`lervo-node supervise --config <config.json>` runs the existing supervision service without a Hub or conversation transport. The owner-only JSON file contains exactly `schemaVersion: 1`, `repositoryRoot`, and `outcomeSupervision`. A relative repository root resolves from the configuration file's directory. Configuration is limited to 1 MiB and reuses the existing exact supervision parser, provider login boundary, workspace configuration, and installed authority binding.

`lervo-node supervise --check-config <config.json>` validates the private configuration without opening storage, observing authority, or starting a provider. Success proves only configuration validity. The running command checks current authority through the normal service and retains all mandate expiry, resource accounting, responsibility, designated-host, and effect admission rules.

The local command rejects `resultOrigin` because it has no conversation adapter. Accepted results remain in their canonical workstream and artifact records. Transport-backed Node configuration remains responsible for external publication.

## Process lifetime

The command installs SIGINT and SIGTERM handlers before opening the service. If stopped during startup, it closes the opened service without starting its loop. A normal stop drains service shutdown before returning exit status zero, and duplicate signals do not close the service twice. Startup failure, service failure, or failed shutdown returns a nonzero status. Signal handlers are removed on every settled path.

## Health and privacy

Each observed service health update writes one JSON line containing `schemaVersion: 1`, `component: "supervision"`, `status`, and a `failureCode` only when health is unavailable. These process observations are neither canonical events nor acceptance receipts. A ready observation proves service operation, not goal completion. Blocked or uncertain work remains unavailable under the existing service contract. Idle cycles without a fresh report do not create a health observation.

Diagnostics contain bounded failure codes and exclude prompts, task prose, filesystem paths, credentials, provider errors, and configuration bodies. A failed health write fails the service. The command adds no event schema, authority source, polling loop, persistent registry, or automatic service installation.
