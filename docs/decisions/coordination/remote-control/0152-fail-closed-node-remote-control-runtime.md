# ADR-0152: Fail-Closed Node Remote-Control Runtime

- Status: accepted; extended by ADR-0153 for built-in managed providers
- Decision date: 2026-08-22

## Context

Signed policy, remote command delivery, payload loading, and replay storage existed separately, but the installed Node composed only outbound sync. Correct ordering and explicit execution authority were still required.

## Decision

`runRemoteControlLoop` synchronizes the policy bundle before every command cycle. An unreachable or unauthenticated Hub produces `policy_unavailable` and no command lease. Only a fully verified `unchanged`, `applied`, or `duplicate` snapshot permits one reconnect cycle. Policy and command phases, and all subsequent cycles, are serial. `processed` continues immediately; idle and deferred outcomes use bounded schedules. Cryptographic or SQLite integrity failure is fatal.

`remoteCommands` configuration includes the Node ID, command and policy Ed25519 public-key files, and bounded polling, HTTP, and receiver settings. Key scope freezes the current project identity. Key files must be owner-only, regular UTF-8 files. Duplicate IDs or purposes and unknown fields fail before startup.

Remote control activates only when the same `openNodeRuntime` call explicitly supplies both `RemoteCommandExecutor` and `LocalCommandCapabilityPolicy`. Configuration alone or either port alone fails before network access. The basic `lervo-node` CLI never guesses a provider. ADR-0153 may assemble built-ins only from an explicit `providerHost.providers` allowlist; ADR-0155 also requires role registration.

Path amendment: [ADR-0213](../../operations/storage/0213-deletable-derived-state-boundary.md) moves policy snapshots to `.lervo/data/policy.sqlite` and replay reservations and receipts to `.lervo/data/remote-command-replay.sqlite`. When storage opens, it relocates their exact legacy state files and SQLite sidecars without overwriting conflicts. These stores exclude requests, envelopes, provider errors, and credentials.

Outbound sync and remote control share abort but run independently. A fatal loop failure blocks new cycles, waits for bounded in-flight work, then closes replay, policy, and event stores in that order. Public failures distinguish `sync_runtime_failed` from `remote_control_runtime_failed` without exposing sensitive causes.

No event or durable scheduler state is added. In-memory `policy_unavailable` and `command_checked` states are not evidence of execution or of selected, loaded, injected, or used status. Signed policy and replay records remain restart truth. Hub-free local execution is unchanged.

## Consequences

Fixtures prove:

- no command request follows policy authentication failure;
- policy and command phases are serial;
- key loading enforces owner-only access;
- real signed snapshots and commands are processed; and
- recovery after a lost acknowledgement invokes the executor once.

Production TLS, hot reload, service supervision, and provider-host implementation remain separate.
