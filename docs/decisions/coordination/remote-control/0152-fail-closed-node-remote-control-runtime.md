# ADR-0152: Fail-Closed Node Remote-Control Runtime

- Status: accepted; extended by ADR-0153 for built-in managed providers
- Decision date: 2026-08-22

## Context

Signed policy, remote command delivery, payload loading, and replay storage existed separately, while the installed Node composed only outbound sync. Correct ordering and explicit execution authority were still required.

## Decision

`runRemoteControlLoop` synchronizes the policy bundle before every command cycle. An unreachable or unauthenticated Hub produces `policy_unavailable` and no command lease. Only a fully verified `unchanged`, `applied`, or `duplicate` snapshot permits one reconnect cycle. Policy and command phases and subsequent cycles are serial. `processed` continues immediately; idle and deferred outcomes follow bounded schedules. Cryptographic or SQLite integrity failure is fatal.

`remoteCommands` configuration contains Node ID, command and policy Ed25519 public-key files, and bounded polling, HTTP, and receiver settings. Key scope freezes the current project identity. Files must be owner-only, regular UTF-8 files. Duplicate IDs or purposes and unknown fields fail before startup.

Remote control activates only when the same `openNodeRuntime` call explicitly provides both `RemoteCommandExecutor` and `LocalCommandCapabilityPolicy`. Configuration alone or either port alone fails before network access. The basic `lervo-node` CLI never guesses a provider. ADR-0153 may assemble built-ins only from an explicit `providerHost.providers` allowlist, and ADR-0155 additionally requires role registration.

Policy source remains `.lervo/state/policy.sqlite`; replay reservation and receipts remain `.lervo/state/remote-command-replay.sqlite`. These stores exclude requests, envelopes, provider errors, and credentials.

Outbound sync and remote control share abort but run independently. A fatal loop failure blocks new cycles, waits for bounded in-flight work, then closes replay, policy, and event stores in order. Public failures distinguish `sync_runtime_failed` and `remote_control_runtime_failed` without exposing sensitive causes.

No event or durable scheduler state is added. In-memory `policy_unavailable` and `command_checked` states are not execution or selected/loaded/injected/used evidence. Signed policy and replay records remain restart truth. Hub-free local execution is unchanged.

## Consequences

Fixtures prove no command request after policy authentication failure, serial policy and command phases, owner-only key loading, real signed snapshot and command processing, and restart recovery after a lost acknowledgement with one executor call. Production TLS, hot reload, service supervision, and provider-host implementation remain separate.
