# ADR-0013: Provider-neutral managed-write bridge

- Status: `accepted`
- Decision date: 2026-08-19

## Context

M2 could issue path-bound, one-use permits after checking current-generation E3 and role policy; M3 could detect unmanaged repository changes. No common boundary connected Codex or Claude write requests to those permits, so provider runs remained read-only. The orchestrator must not parse provider payloads, adapter completion reports cannot replace byte verification, and raw diffs or tool input violate telemetry minimization.

## Decision

### Responsibilities

- Attach a `ProviderManagedWriteBridge` to each `ProviderAdapter` session. The adapter translates provider protocol into common request, decision, and completion messages; the orchestrator never receives provider-specific payloads.
- `ManagedProviderWriteBridge` validates session/turn coordinates, time order, and duplicates; requests a permit from `ManagedContextRun`; then reads the actual file hash and calls M2 `recordFileChange` after completion.
- The context gate owns role policy, expected paths, E3 generation, target digest, and before/after hashes.
- Final snapshot comparison excludes only paths whose bridge evidence exactly matches pre/post hashes. All other changes remain unmanaged.

### Mode and scope

`AdapterStartRequest` and `AdapterSession` use `read_only` or `managed_write`. Role `deny` means read-only; `allow` means managed write. Do not execute `require_approval` until a verified human-approval source exists.

The first slice permits exactly one normalized `expectedPaths` file. No approved change or a second required change fails the run. The first change invalidates generation and E3; multi-file support requires reinjection or staged runs.

Codex remains in a read-only sandbox, using approval `never` for read-only and `on-request` for managed write. Bridge only a matching single `fileChange` proposal and `item/fileChange/requestApproval`; reject multi-file changes, moves, unsafe paths, command approvals, or unlinked requests. Report completion only after `item/completed`.

Claude read-only uses `plan` plus `Read`, `Glob`, and `Grep`. Managed write uses `default` plus only `Read`, `Glob`, `Grep`, `Write`, and `Edit`. Request approval at PreToolUse and report at PostToolUse/PostToolUseFailure. Do not enable Bash, Agent, Task, external MCP, automatic skills, or filesystem settings.

### Common messages

| Message | Required data |
| --- | --- |
| `managed_write_request` | Common coordinates and `requestedAt` |
| `managed_write_decision` | Common coordinates, `decision`, `reasonCode`, `decidedAt` |
| `managed_write_completion` | Common coordinates, `status`, `completedAt` |

Coordinates include adapter, project/run/session/provider session, target/provider turn, provider item, repository-relative path, `targetDigest`, and `changeKind` (`created`, `modified`, `deleted`, or provider-ambiguous `upsert`). An allow decision uses only `reasonCode=authorized`. Denials identify approval, missing bridge, denied capability, invalid request, missing context, or telemetry failure.

These are local control messages, not append-only events. They contain no bytes, diff, command, tool input, or provider error body. `targetDigest` provides the source-free binding.

### Completion and failure

Bind the actual before-hash immediately before approval. After completion, reread the after-hash and verify create, modify, or delete semantics. Only then atomically record `file.changed` and `context.invalidated` and consume the permit. The final snapshot must confirm the same hashes.

`provider_write_failed` covers missing or failed completion, rejected status, change-kind mismatch, approval without completion, anything other than exactly one change, or snapshot/evidence mismatch. Emit no normal `file.changed` or completion and do not auto-retry. Extra paths separately produce `unmanaged_change.detected`; retain every concurrent failure in the ledger.

## Consequences

- Codex and Claude perform one real file change under common path, context, and hash rules.
- Provider approval protocol stays inside adapters while policy and evidence remain provider-neutral.
- Intent, actual bytes, and full repository state are independently checked.
- ADR-0014 further binds turns and session capabilities and separates controllers.
