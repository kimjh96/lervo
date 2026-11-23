# ADR-0536: Find installed provider CLIs at run time and admit them by contract

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0470](../../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) (service tool directories)

## Context

Background knowledge work runs provider CLIs without capabilities: canonical assessment, normalization, freshness, and instruction capture.

- For Codex, a probe (`codex debug prompt-input` with every tool feature disabled) must show a model input with no tool definitions before each run.
- For Claude, the runner passes `--tools ""`, an empty MCP configuration, and no setting sources, and rejects any reported tool use.

The contract is in `packages/repository-knowledge-compiler/src/process-compiler.ts`.

On 2026-10-31, the core health signal (ADR-0535 (core health projection, open in PR #166)) exposed a stop that no surface had reported:

- Mac convergence for `lervo` had been stopped since 2026-10-29 08:07 UTC with `knowledge_compile_policy_violation`: "The Codex model input contains a disallowed tool or capability definition."
- The Mac host resident ran the Codex on its service `PATH`. That Codex updated to 0.164.0 and then to 0.166.0. Both add an `additional_tools` item with 11 tools, including `exec`, `spawn_agent`, and `request_user_input`. The item survives every documented tool feature being disabled, an empty `CODEX_HOME`, and any model.
- That `PATH` was fixed when `lervo upgrade` installed the service. ADR-0470 renders the tool directories found on the upgrading shell's `PATH` into the launchd or systemd definition, including a version-specific nvm directory and a specific Lervo candidate path. The service keeps whatever was on that machine at that moment. It does not follow later installs, and it is specific to one owner's machine.
- A hand-made pin of Codex 0.156.1 existed on the Mac since 2026-10-01. A later reinstall rewrote the service `PATH` without it, so the pin silently stopped applying. The WSL host has a similar hand-made directory.

On 2026-10-31, the owner's Mac still held a Claude quota pause observed on 2026-09-28 with no reset time. Automatic admission skipped it for 33 days. Recovery required a manual probe, and that probe correctly refused a provider outside the delegation. This addition replaces indefinite automatic skipping with delegated native re-probes and visible pause timing. It preserves the no-capability contract and delegation boundary.

## Decision

### Find installed CLIs when work runs

Background no-capability work never uses a provider path fixed at service install time. Before a run, Lervo finds the provider CLIs installed on that machine. It uses the same CLIs, with the same login and credentials, that the owner uses. The same procedure runs on macOS and Linux, in this order:

1. The executables the user's login shell resolves, run with a bounded timeout. A fixed script removes aliases and provider functions before lookup. Provider names are positional arguments. The lookup also captures the login `PATH` privately. Missing or empty `HOME` and `SHELL` use the system account entry, then the system fallback.
2. Well-known install locations:
   - the npm global prefix and Homebrew prefixes;
   - `~/.local/bin`;
   - the Claude native installer location;
   - the active nvm default;
   - Volta, asdf, and mise shims.

3. An executable the owner names explicitly in Lervo configuration, as an override. It is never required.

The npm prefix comes from the owner’s `.npmrc` or common global bins. Detection never runs npm configuration or installation commands.

Each candidate keeps its invocation path and its identity real path separately. Invocation preserves a shim’s file name. Version, probe, and model processes use the captured login `PATH`, with the invocation directory first. This private environment is never logged or published.

Each candidate is identified by its real path, version, content hash, invocation path, and private invocation environment. Before every provider call, Lervo checks the real path and its device, inode, size, and modification time. Native executables outside version-manager paths reuse the content hash and version when the fingerprint is unchanged. Scripts, known shim directories, and symlink chains through version managers also bind identity to a hash of the bounded `--version` output. Lervo reruns `--version` before each call and when evaluating these candidates for use, even when shim bytes are unchanged. Unprobed candidates reuse their stat-bound detection observation until evaluation. A changed output requires readmission. A changed file fingerprint is rehashed and readmitted. A changed identity stops the current batch. The next turn builds a compiler with the readmitted identity and a new descriptor; new calls never inherit the old descriptor. Detection also reruns on a bounded schedule. Service definitions no longer embed provider tool directories. They carry only what starts Lervo itself. Convergence verification commands run with the same captured login `PATH`, so a suite's own tools, such as `pnpm` for the isolated workspace, resolve as they do in the owner's shell; without a login `PATH`, the service `PATH` stands. Until 2026-11-23 they ran with the service `PATH`, and every canonical integration since October failed on `spawnSync pnpm ENOENT`. The integrator's own suite was missed at first and failed the same way, so every convergence suite now runs through one helper, and a test fails on any direct call.

### Admit by contract

- A detected executable is **admitted** for background work when it satisfies the no-capability contract for its provider.
  - Codex passes the existing model-input probe.
  - Claude runs with the existing no-tool flags. Its admission validator rejects any `structured_output`, requires exactly one turn with `end_turn`, an empty permission-denial list, zero server-tool counters, and the exact reply `{"ok":true}`. The ordinary native structured-output parser cannot admit a probe.
- Detection identities are cached separately from admission results, including candidates not probed because an earlier candidate qualified or delegation excluded them. Unchanged unprobed candidates reuse their stat-bound content hash and version. Dispatching candidates refresh version output before admission or selection. Admission is cached by executable identity and invalidated when the identity changes, so an update is re-probed before its first use. A per-identity in-flight guard and a host cache lease serialize probing and cache replacement. Cached-only observers never write the cache, events, or project projection.
- Version checks, identity checks, contract probes, and model calls share dispatch policy `filesystem-root-allowlist-v1`. Each process starts at the filesystem root with the same allow-listed environment construction and the captured login PATH. The invocation directory still precedes that PATH. Checkout and temporary-directory names cannot choose a different shim target. Response-schema files retain their private temporary paths. The dispatch policy is part of executable identity; a policy change requires fresh admission.
- Failed transient probes retry after 60 seconds, then double the delay up to one hour. Capability rejections remain rejected for that identity.
- Candidates are probed in provider resolution order. Probing stops at the first admitted candidate. A paid Claude probe reserves a call from the delegation-scoped admission-probe budget and records native usage or its absence. Missing usage cannot admit a paid probe. Quota and authentication failures enter the existing provider pause contract. A pause with a known reset keeps its existing expiry. A pause without a reset is eligible for automatic native re-probing after one hour from `observed_at`. Each admitted re-probe doubles the next delay, capped at 24 hours, from the last attempt. The host admission transaction reserves that schedule before releasing its lock. Resolution probes only the next allowed candidate; a later or disallowed provider remains paused. Cached admission cannot skip a due re-probe. A successful native probe with observed usage clears only the exact prior observation hash and observation time through the explicit probe's compare-and-settle rule. A newer failure remains paused. Elapsed time alone never clears a pause. Claude uses its native admission response; Codex also requires a paid native nonce probe after its model-input contract passes. Both paid recovery paths use the existing delegated admission-probe budget and usage recording. Cached-only observers never probe. Other paused providers are skipped, including cached admissions. Resolution continues with other allowed providers. A quota or authentication failure during probing records that provider pause and continues resolution without caching a capability rejection. Explicit availability recovery retains its separate authority.
- A failing executable is **rejected** with a closed reason and the exposed tool names. Lervo never relaxes the boundary to make it pass.

### Choose a provider, then wait if none qualifies

- Use the provider the delegation names if it has an admitted executable.
- Otherwise use another provider the delegation allows that has one. For example, Claude runs while the installed Codex is rejected.
- Otherwise wait with `provider_not_admitted`. The stage is readmitted when detection finds an admitted executable.

### Same behavior on every host

Each host publishes its detected and admitted providers and versions in its continuity peer record (ADR-0469). Hosts may run different installed versions, because each runs what its owner installed. They behave the same because each runs only executables that pass the same contract. The health projection shows the provider and version each host uses, and shows a difference when it exists. The selected provider comes from the worker’s last model-call observation. Reconciliation publishes currently admissible candidates separately and never substitutes the first delegation entry for that observation.

Automatic pause re-probes normalize native timeouts to `probe_timed_out` and invalid responses to `probe_failed`, including runner preparation failures. These results leave the pause intact and permit evaluation of the next allowed candidate. Authority, budget, and usage-recording errors retain their original scope and propagate.

### Nothing silent

Detection results, admissions, rejections, and waits appear in the core health projection with the actor `provider admission`. A rejection names its reason. For example: "codex 0.166.0 not admitted: model input exposes exec, spawn_agent, …; using claude 2.1.308." The existing `provider_not_admitted` continuity finding also reports every host provider pause, including one excluded by delegation. It names the normalized reason, observation time, age in milliseconds, next automatic re-probe time, and known reset time. It retains actor `provider admission` and attention severity even when an allowed fallback runs. These are upkeep, not owner actions.

Local continuity inspection opens an existing admission database read-only. It never creates directories, changes permissions, migrates tables, or repairs the store. An absent or old schema yields no pause observations. Locked, unreadable, or invalid admission state also leaves other continuity and provider-admission findings visible. Missing observations never clear a pause.

## State, events, privacy, and failure meaning

- `provider.cli.admitted`: `provider`, `version`, `executableHash`, `probeResultHash`, `hostLabel`, `admittedAt`.
- `provider.cli.rejected`: `provider`, `version`, `executableHash`, `reason`, `exposedTools` (bounded closed names), `hostLabel`, `rejectedAt`.
- Events never record absolute paths, prompts, credentials, or provider output. The detection cache is private Lervo state and may hold resolved paths.
- `provider_not_admitted`: as a stage wait, no detected executable of an allowed provider satisfies the contract. The stage waits and is readmitted on admission. Continuity also uses that code with pause details for an individual provider while a fallback may run.
- A login shell that fails or times out is reported as a detection failure; Lervo then uses the well-known locations alone.

## Verification

Focused tests must show:

- Detection finds executables through a login shell and well-known locations, and never uses a path fixed in a service definition.
- A changed executable identity between calls stops the old batch, requires readmission, and rebuilds the compiler descriptor before another call. This includes changed shim dispatch with unchanged file bytes and stat fingerprint.
- Version, identity checks, probe, and execution of an `env node` CLI use the login Node even when the service PATH resolves a different Node. Invocation preserves shim names. A cwd-sensitive shim sees the same neutral cwd and allow-listed environment for every step.
- Alias and function removal exposes the real executable. Volta/asdf/mise locations and shell-failure fallback work with empty `HOME` and `SHELL`. Detection, admission, and execution use the resolved account environment.
- A native structured-output tool response cannot bypass the Claude admission validator.
- Paid probes reserve budget, record usage, honor provider pauses, stop after the first admission, and back off on repeated failures. A paused preferred Claude permits an allowed Codex to be admitted and used.
- A NULL-reset pause first re-probes after one hour, doubles later delays to 24 hours, and clears only on native success with observed usage. A newer failure during that probe is preserved. Disallowed providers and cached-only observers never probe; continuity still reports pause age and next eligibility.
- Unprobed native candidates reuse detection identities without rehashing or another version command. Later delegation or preference changes still require their first contract probe.
- Concurrent cache readers and probes cannot overwrite a newer admission; cached-only observers never write. Local continuity inspection preserves database bytes, permissions, schema, and sidecar files for current and old stores. An absent or failed admission read never hides unrelated findings.
- A timed-out or invalid native pause re-probe leaves the pause intact and evaluates an allowed fallback. Authority and budget errors still abort resolution.
- Schema-before-4 conversation background normalization uses the same admission and per-call identity checks.
- Continuity preserves the worker observation when preferred and delegation orders differ.
- A Codex build that exposes tool definitions is rejected, and an admitted Claude runs the stage.
- With no admitted provider, the stage waits with `provider_not_admitted` and is readmitted when one appears.
- Upgrade replaces an existing service definition that contains a frozen provider directory. The replacement contains no provider tool directories.
- Detection, admission, and rejection appear in the health projection with the `provider admission` actor.

Installed verification must show the Mac `lervo` convergence leaving `knowledge_compile_policy_violation`.
