# Native login readiness

## Profile selection and provider boundary

The explicit Node supervision factory accepts `runtimeReadiness.providerLoginContexts`, keyed by Codex or Claude. Each context contains only `homeDirectory` and `configurationDirectory`: absolute paths of at most 4096 characters without NUL. Unknown context fields are rejected before storage opens. The host supplies this trusted configuration and the selected absolute provider executable. Model output cannot select a profile or add credentials. Node snapshots the configuration; the effect adapter must use the same reviewed profile at commit.

The adapter requests `codex login status` or `claude auth status --json`, using the explicit home as its working directory. A bounded shared process helper supplies PATH with the host Node executable discoverable, HOME and USERPROFILE. Codex adds CODEX_HOME; Claude adds CLAUDE_CONFIG_DIR. Parent API-key, token and other environment variables are not inherited. Environment-only authentication and other transports require separate observations; this profile probe does not establish their readiness.

Each probe spawns the executable and arguments directly, with ignored stdin, no shell, a five-second timeout and a combined stdout/stderr limit of 16 KiB. It requests no inference, login, logout or task command. Native status and credential-store behavior remains provider-owned. The probe claims neither process quiescence nor zero native credential-store side effects.

## Adapter evidence

The ephemeral `ProviderLoginInspection` contains only `provider`, `status` and `reasonCode`. Provider is `codex` or `claude`. It returns no account identity, raw output, key, token, path or unrestricted error.

| Status | Reason | Meaning |
| --- | --- | --- |
| `login_present` | `native_login_present` | A successful native response reports stored login configuration. |
| `login_absent` | `native_login_absent` | A recognized native response reports no login. |
| `unobserved` | `unrecognized_response` | Output, exit status or their relationship is unsupported or contradictory. |
| `unobserved` | `executable_not_found` | The probe could not start because its executable/context was missing or inaccessible. |
| `unobserved` | `probe_failed` | Process startup failed or output exceeded the bound. |
| `unobserved` | `probe_timed_out` | The bounded native status request did not finish. |

Codex accepts exactly one recognized ChatGPT or API-key login line with a successful exit, or its recognized logged-out line with the corresponding failure exit. Claude requires a JSON object with a boolean `loggedIn`, a consistent exit status and no stderr. Other account fields are discarded. Malformed output and parser errors never expose native content.

A native login report proves no account identity, token freshness, server authentication, model entitlement, billing capacity, tool permission, endpoint identity or successful request. API-key details printed by a native command remain transient parser input and are never retained in Lervo evidence.

## Node admission and failure meaning

Dispatch, retry and owner execution repeat the observation before final admission. Only `login_present` within a zero-to-five-second observation interval can supplement an already passed application provider check with evidence. Missing configuration, login absence, unknown output, failure or stale timing changes that positive check to `unobserved` with null evidence. Existing failed, unobserved, not-required, missing and missing-hash application checks are never promoted.

Combined readiness evidence hashes the prior application evidence, executable/profile coordinates and normalized result. It retains no raw identity or output and preserves the original application observation time. Version inspection remains independent. New local login evidence cannot refresh stale service-authentication or permission evidence.

This adds no event, persistent login projection, credential manifest or production startup activation. The effect adapter still rechecks exact service and task permission at its own commit boundary.

## Validation and remaining work

Shared native-protocol fixtures test both providers, exact arguments and explicit profile environments, identity/API-key output redaction, missing login, malformed or contradictory responses, output bounds, missing executables and timeout. Node tests cover missing context, caller profile mutation, login disappearance between preflights and preservation of negative application evidence. Fixtures use no real credentials or inference requests.

Remote authentication and task-tool permissions, worker context delivery, research source policy, verification execution, budget/process observations and responsibility installation remain separate work. A stored-login report cannot authorize an installed worker by itself.
