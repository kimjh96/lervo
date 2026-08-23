# ADR-0152: Fail-Closed Node Remote-Control Runtime

- Status: accepted; extended by ADR-0153 for built-in managed providers
- Decision date: 2026-08-22

## Context

Signed policy, remote command delivery, payload loading, and replay storage existed separately, while the installed Node composed only outbound sync. Correct ordering and explicit execution authority were still required.

## Decision

runRemoteControlLoop synchronizes the policy bundle before every command cycle. Unreachable or unauthenticated Hub yields policy_unavailable and never leases commands. Only a fully verified unchanged, applied, or duplicate snapshot permits one reconnect cycle. Policy and command phases and subsequent cycles are serial; processed continues immediately, idle/deferred obey bounded schedules, and cryptographic or SQLite integrity failure is fatal.

remoteCommands config contains Node ID, command/policy Ed25519 public-key files, and bounded polling/HTTP/receiver settings. Key scope freezes current project identity. Files are owner-only regular UTF-8; duplicate IDs/purposes and unknown fields fail before startup.

Remote control activates only when the same openNodeRuntime call explicitly supplies both RemoteCommandExecutor and LocalCommandCapabilityPolicy. Config alone or one port fails before network. The basic lervo-node CLI never guesses a provider. ADR-0153 may assemble built-ins only from an explicit providerHost.providers allowlist, and ADR-0155 additionally requires role registration.

Policy source remains .lervo/state/policy.sqlite and replay reservation/receipt .lervo/state/remote-command-replay.sqlite. They exclude requests, envelopes, provider errors, and credentials.

Outbound sync and remote control share abort but run independently. A fatal loop failure blocks all new cycles, waits for bounded in-flight work, then closes replay, policy, and event stores in order. Public failures distinguish sync_runtime_failed and remote_control_runtime_failed without sensitive causes.

No event or durable scheduler state is added. Memory policy_unavailable/command_checked states are not execution or selected/loaded/injected/used evidence. Signed policy and replay records remain restart truth. Hub-free local execution is unchanged.

## Consequences

Fixtures prove no command request after policy authentication failure, serial policy/command phases, owner-only key loading, real signed snapshot/command processing, and restart recovery after lost acknowledgement with one executor call. Production TLS, hot reload, service supervision, and provider-host implementation remain separate.
