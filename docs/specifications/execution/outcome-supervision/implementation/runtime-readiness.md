# Supervision executable readiness

## Trusted configuration

The explicit Node supervision factory accepts `runtimeReadiness` as a detached snapshot of trusted host configuration, never model output or a proposed action:

- `providerExecutables` selects absolute Codex or Claude executable paths.
- `verificationTools` maps exact responsibility verification-suite IDs to tool IDs and absolute executable paths.
- Optional `verificationSuiteHashes` supplies [reviewed verification-definition pins](verification-readiness.md). Execution readiness requires a pin for every responsibility suite.
- Optional `providerLoginContexts` supplies [explicit profiles for native login observation](login-readiness.md). Execution readiness requires a context for the selected provider.

Hosts must use the same configured runtimes for effects and revalidate permission at their commit boundary.

Configuration permits at most 32 suites and eight distinct tool identities. IDs contain at most 128 ASCII identifier characters. Executable paths must be absolute, contain no NUL, and be at most 4096 characters. Conflicting paths for one tool ID are rejected before storage opens. An explicit empty suite mapping describes an in-process suite but proves no verification result. Shell execution also requires at least one mapped executable and positive application CLI evidence.

## Runtime observations

Each execution preflight observes the selected provider through its adapter and each distinct mapped tool through shared executable inspection. Provider-specific runtime selection stays in provider adapters. Probes use:

- Fixed version arguments, no shell, and a PATH-only environment.
- A five-second timeout and 16 KiB output bound.
- A printable version line of at most 200 characters.
- At most nine concurrent probes.

Observations repeat before final admission for dispatch, retry, and owner execution.

## Evidence and failure meaning

Executable availability supplements existing positive provider, tool, and required CLI checks. It cannot promote failed, unobserved, not-required, or missing-hash application evidence. Each of these conditions makes affected positive checks `unobserved` with a null evidence hash:

- Missing configuration or an unmapped required suite.
- Unavailable or unknown executable observations.
- A probe interval outside zero to five seconds.

Existing failed checks remain failed. A permission-denied executable start instead makes the affected positive check `failed` with a combined evidence hash. The runtime records that observation through [`work.supervision.readiness.failed`](readiness.md#permission-failure-evidence-and-recovery). Other probe outcomes introduce no event or persistent state.

Combined evidence hashes bind prior application evidence, configured executable identities, and normalized probe results. Readiness records expose no raw executable paths, output, credentials, or unrestricted errors. Probes preserve the original readiness observation time; observing a binary cannot refresh stale authentication evidence.

A version response proves only that an executable answered the probe. It proves no authentication, authorization, MCP-tool access, successful verification, task execution, provider-process quiescence, or immutable executable identity. The effect adapter owns exact runtime and permission checks at commit. Stock Node startup does not activate this supervision factory.

## Validation and remaining work

Real child-process tests cover bounded output, credential isolation, missing executables, permission-denied executables, timeout, and provider-neutral tool results.

Disposable Git-workspace tests block on a permission-denied provider or tool, record one canonical readiness failure across repeated cycles, and confirm the original decision after permission is repaired. Disposable Git-workspace integration tests cover absent configuration, unavailable provider or tool, missing suite mapping, preservation of negative authentication evidence, a detached configuration snapshot, and an executable removed between preflights. Existing dispatch tests exercise repeated preflight before fenced effects.

Actual authentication and task-tool permissions, knowledge/source-policy observations, verification execution, budget and process observations, and production responsibility installation remain separate delivery work. These probes cannot establish installed-worker readiness on their own.
