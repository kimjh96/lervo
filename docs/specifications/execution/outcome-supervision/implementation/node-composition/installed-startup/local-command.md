# Local supervision command

`lervo-node supervise --config <config.json>` runs the existing supervision service without a Hub or conversation transport. The owner-only JSON configuration contains exactly `schemaVersion: 1`, `repositoryRoot`, and `outcomeSupervision` and is limited to 1 MiB. A relative repository root resolves from the configuration file's directory. The command reuses the existing exact supervision parser, provider login boundary, workspace configuration, and installed authority binding.

`lervo-node supervise --check-config <config.json>` validates the private configuration without opening storage, observing authority, or starting a provider. Success proves only configuration validity. The running command checks current authority through the normal service and retains all mandate expiry, resource accounting, responsibility, designated-host, and effect admission rules.

`lervo-node supervise --config <config.json> --request-stdin` reads one bounded UTF-8 request from stdin, binds it under the installed owner lease through the [shared request intake](request-intake.md), prints its canonical event ID, and starts the same service.

- Replaying identical stdin on the same current goal returns the existing binding.
- Empty, malformed, or oversized input fails before service startup.
- A different source cannot replace an already bound goal.
- Under `outcomeSupervision.standing`, the request enters standing intake, which may start the next successor goal when the current goal is settled and the grant remains. A scoped service already running on the same lineage follows that successor on its next cycle.
- A typed intake refusal exits with `request_refused_<code>` using the shared intake's bounded codes; no event is written. For example, `request_refused_owner_busy` applies when a running service holds the owner fence past the 30-second local deadline.

The command rejects `resultOrigin` because it has no conversation adapter. Accepted results remain in their canonical workstream and artifact records. Transport-backed Node configuration remains responsible for external publication.

## Process lifetime

The command installs SIGINT and SIGTERM handlers before opening the service. If stopped during startup, it closes the opened service without starting its loop. A normal stop drains service shutdown before returning exit status zero. Duplicate signals do not close the service twice. Startup failure, service failure, or failed shutdown returns a nonzero status. Signal handlers are removed on every settled path.

## Health and privacy

Each observed service health update writes one JSON line containing `schemaVersion: 1`, `component: "supervision"`, and `status`. Only unavailable health includes `failureCode` and the blocked or uncertain cycle's bounded attention `reasonCodes`.

These process observations are neither canonical events nor acceptance receipts. A ready observation proves service operation, not goal completion. Blocked or uncertain work remains unavailable under the existing service contract. Idle cycles without a fresh report create no health observation.

Health output excludes prompts, task prose, filesystem paths, credentials, provider errors, and configuration bodies. The shared service's diagnostic logger has a different boundary: it can retain error messages and up to three causes, with a 200-character combined-message limit for cycle and evidence-read failures and a 400-character limit for uncertain effects. These limits do not bound the whole line, and the formatter performs no general redaction. Diagnostic text can therefore retain those contents when present in upstream errors. The service defaults to the process error stream unless a logger is supplied; no local-command exemption from this shared diagnostic behavior is established. See [Service diagnostics and recovery evidence](readiness-and-failure.md#service-diagnostics-and-recovery-evidence) for exact formatting and callback failure behavior.

A failed health write fails the service. The command adds no event schema, authority source, polling loop, persistent registry, or automatic service installation.
