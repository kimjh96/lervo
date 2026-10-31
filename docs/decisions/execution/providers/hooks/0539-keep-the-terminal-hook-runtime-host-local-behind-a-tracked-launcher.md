# ADR-0539: Keep the terminal hook runtime host-local behind a tracked launcher

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0204](../0204-self-contained-repository-terminal-hook-runtime.md) (runtime location), [ADR-0502](../../../distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md) (native asset location), [ADR-0469](../../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) (deferred hook runtime refresh)

## Context

[ADR-0204](../0204-self-contained-repository-terminal-hook-runtime.md) materializes the terminal hook runtime into every repository as Lervo-generated tracked bytes: `.lervo/generated/terminal-hooks/runtime-v2.mjs`, its manifest, and, under [ADR-0502](../../../distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md), native assets such as `native/cas-io-darwin.node`.

On 2026-10-31 this caused four problems:

- **Churn.** The runtime is an 8.35 MB bundle of the CLI. Every CLI change rewrites it, so the owner sees it reappear in `git status` after commits. On `main`, 73 commits in `lervo` changed it, such as "chore: refresh generated terminal hooks for 0.22.4". `flemo` has 8 and `axli` has 7. Each adds a new multi-megabyte blob to history.
- **Cross-host conflict.** Mac and WSL run different CLI builds and platforms. Each host writes its own bytes, including Mac-only native assets, to the same tracked paths.
- **Stale runtimes stay stale.** Because refresh writes tracked bytes, [ADR-0469](../../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) deferred automatic refresh. The continuity finding `hook_runtime_stale` asks the owner to run `lervo upgrade` and apply its plan, which makes the owner a bookkeeping queue.
- **Clone without Lervo.** A clone on a host without Lervo carries 8 MB of code it cannot use.

The runtime is host software. Only the hook's entry point needs to live in the repository, because provider hook commands name it and Codex trust review binds it.

## Decision

### A tracked launcher at the existing path

`.lervo/generated/terminal-hooks/runtime-v2.mjs` becomes a small launcher, at most 16 KiB. The provider hook commands, `commandWindows`, and Codex trust are unchanged, because the path and contract `lervo_terminal_hooks_v2` are unchanged.

The launcher only locates, verifies, and starts the host runtime. It holds no Lervo behavior, so its bytes change only when the launcher contract changes, never with a CLI release. Its adjacent manifest `runtime-v2.json` uses schema 4 with kind `lervo_terminal_hook_launcher` and binds the launcher's byte count and hash. Native assets are no longer tracked.

### A host-local runtime store

Each host keeps its runtime in a private store:

- `~/.lervo/terminal-hooks/` on macOS and Linux;
- `%LOCALAPPDATA%\Lervo\terminal-hooks\` on Windows.

The store holds one directory per runtime, named by the first 16 hexadecimal characters of its content hash. A repaired artifact may append `-repair-` and 16 random hexadecimal characters. Repair stages a fresh directory and switches the pointer without removing the directory that readers still name. Each directory contains the bundle, the native assets for that host's platform, and an integrity manifest with the same fields as today's schema 3. A pointer file `current.json` names the active directory, its full content hash, and `publisher`, the real absolute path of the CLI entry that published it. Directories are `0700` and files `0600` or `0700`. A runtime is written to a temporary directory and renamed into place, and the pointer is replaced last.

On POSIX, the launcher requires the store, runtime directories, and pointer to belong to the current uid and forbids group or other writes. It rejects symlinks for these coordinates and declared files. The store's parent chain may resolve through a symlink only within the user's real home directory. Windows ACL validation remains a follow-up.

The store keeps the current runtime and its predecessor, so a hook started before a switch can finish. Older directories are removed when a new runtime becomes current, under the host lock that guards the store.

### Launcher behavior

On every invocation the launcher:

1. resolves the store and reads `current.json`;
2. verifies the runtime and every declared asset by byte count and SHA-256 against the store manifest, as ADR-0204 requires before reading hook input;
3. imports the runtime in the same process, so the runtime reads the original arguments, standard input, and working directory, and sets the exit code. No second Node process starts on the prompt path. A process-local, one-use receipt identifies the verified entry so the runtime does not repeat verification and misclassify a later deletion as an integrity failure. Direct runtime invocation still verifies itself.

The launcher bounds the runtime at 64 MiB. It outlives CLI releases, so the bound leaves room for the runtime to grow.

Failures are split by meaning:

- **Unavailable.** No store, no pointer, or a missing manifest, runtime, asset, runtime directory, or import entry means Lervo is not installed or not yet materialized on this host. The launcher exits 0 with no output, so the provider turn proceeds as `unmanaged` ([ADR-0327](0327-availability-safe-unmanaged-terminal-hooks.md)). It writes a host-local unavailable marker that the resident reads. Any `ENOENT` after reading the pointer, including at import, re-reads the pointer and retries once. A second missing file remains unavailable. Missing declared assets are unavailable; undeclared assets remain integrity failures.
- **Integrity failure.** A byte-count or hash mismatch, malformed manifest, symlink, or POSIX trust violation fails closed as ADR-0204 requires: no input is read, and the launcher exits 2 with a fixed message. It also writes a repair marker on a best-effort basis; unsafe or unwritable stores can prevent the marker write. Exit 2 blocks UserPromptSubmit and forces Stop continuation in both Claude Code and Codex. It is reserved for integrity failures.

Same-user TOCTOU between verification and `import()` is outside this contract. A same-user attacker can already edit repository files. This does not relax the missing-file retry or POSIX trust checks.

### Materialization is automatic and host-local

Writing the host store is a host-local write, not a repository write, so it needs no owner approval. Publication has two authorities:

- An installed CLI starting interactively always publishes its runtime when the pointer differs. Explicit knowledge migration also has publication authority.
- The host resident is repair-only. It publishes only when the pointer is missing or invalid, an unavailable, repair, or interrupted-publication marker exists, or the pointer's publisher entry no longer exists. It rechecks this decision under the publication lock. Resident A cannot revert a valid runtime published by installed CLI B.

A source checkout is detected by an adjacent source entry (../src/bin.ts) beside the running dist/bin.js. It never publishes at startup. Every other layout is installed, including npm or pnpm global installations, pnpm deploy, and Lervo-managed settled-* directories.

Unchanged startup reads the pointer without loading the runtime bundle. An unavailable or repair marker makes startup and the resident verify the artifact before rematerializing from their trusted installed CLI. Successful verification and publication clear the markers. A same-hash repair uses a fresh directory and retains its predecessor.

The ADR-0470 local-reader preflight verifies the currently published artifact. It accepts a valid v2 runtime from another live publisher without requiring the resident's embedded hash. Missing, invalid, or marked artifacts still block reader readiness.

This resolves the refresh that ADR-0469 deferred. `hook_runtime_stale` is replaced by `hook_runtime_unavailable`, which the resident repairs itself and which names the resident as its actor. It reaches the owner only when repair fails for a consequential reason, such as an unwritable home directory.

All repositories on a host share the host runtime. The contract identifier is the compatibility coordinate: any `lervo_terminal_hooks_v2` launcher works with any v2 runtime.

### Migration of existing repositories

The next generated-only reconciliation under ADR-0204 replaces the tracked bundle with the launcher and removes the tracked native assets. After all hosts upgrade, further CLI releases leave those tracked bytes unchanged. It uses the existing Lervo-generated authority and rollback journal, and `terminal.integration.applied` binds the launcher hash as `runtimeAfterHash`. User-owned provider configuration is not touched.

## State, events, privacy, and failure meaning

- No event type is added. The store manifest and pointer are private host state. The manifest holds hashes, byte counts, and relative asset names. The pointer also holds `publisher`, a host-local software installation path; it never leaves the host. Neither holds repository paths, prompts, or provider output. Pointer schema 1 requires `schemaVersion`, `directory`, `contentHash`, `publisher`, and nullable `predecessor` with directory and hash coordinates. Invalid coordinates require repair.
- `terminal.integration.applied` keeps its fields; after migration `runtimeAfterHash` is the launcher hash.
- `hook_runtime_unavailable` (continuity finding, actor `host resident`): the launcher found no usable host runtime since the last resident cycle. It clears when a verified runtime is current.
- `unavailable.json` and `repair.json` are private replace-in-place markers with required `schemaVersion: 1` and closed `code` values `hook_runtime_unavailable` and `hook_runtime_repair`. They contain no paths or input and add no event. They persist until verification and repair succeed. An integrity failure exits 2 on the failing invocation even when later automatic repair succeeds.

## Consequences

- Once every host runs the new CLI, releases no longer change tracked runtime bytes and Mac and WSL converge on the same tracked launcher. During rollout, older deployed CLIs can still replace the launcher with their full bundle. New reconciliation is idempotent and restores the launcher and removes legacy native assets on its next authorized reconciliation.
- Each repository's history stops growing by 8 MB per runtime refresh. Existing history is unchanged.
- A clone on a host without Lervo carries only the launcher and works as `unmanaged`.
- A host with Lervo installed but no materialized runtime, for example right after a manual store deletion, runs unmanaged until the next CLI command or resident cycle.

## Verification

Focused tests must show:

- the launcher is at most 16 KiB, contains no CLI version, and is byte-identical across builds with the same launcher contract;
- the launcher starts a verified host runtime with the original arguments, input, working directory, and exit code;
- an unavailable store exits 0 with no output and writes the marker;
- a tampered runtime or asset fails closed without reading input;
- materialization is atomic, keeps exactly the current runtime and its predecessor, and is idempotent;
- migration replaces the tracked bundle with the launcher, removes the tracked native assets, and leaves provider configuration unchanged;
- default startup and resident paths repair a marked corrupt artifact without explicit artifact-verification options;
- resident A leaves CLI B's published runtime unchanged on rescan and ADR-0470 reader preflight accepts it;
- structural installation detection covers source checkout, global, deploy, and settled layouts;
- source-checkout startup never changes the pointer and installed startup publishes the upgrade.

Installed verification must show, on Mac and WSL, a CLI upgrade that changes no tracked bytes in `lervo`, `flemo`, or `axli`, and a working `UserPromptSubmit` hook from a repository subdirectory.

## Remaining verification

Windows ACL checks and installed Mac/WSL verification remain follow-ups. The old→new→old→new deployed-CLI rollout fixture is not included; it needs an older packaged CLI. Focused tests cover idempotent new reconciliation and installed startup separately.
