# ADR-0013: Provider-neutral managed-write bridge

- Status: `accepted`
- Decision date: 2026-08-19

## Context

M2 could issue path-bound, one-use permits after validating current-generation E3 and role policy, and M3 could detect unmanaged repository changes. No common boundary connected Codex or Claude write requests to those permits, so provider runs remained read-only. The orchestrator must not parse provider payloads; adapter completion reports cannot replace byte verification; raw diffs and tool input violate telemetry minimization.

## Decision

### Responsibilities

- Attach a `ProviderManagedWriteBridge` to every `ProviderAdapter` session. The adapter translates provider protocols into common request, decision, and completion messages; the orchestrator never receives provider-specific payloads.
- `ManagedProviderWriteBridge` validates session and turn coordinates, time order, and duplicates; requests a permit from `ManagedContextRun`; reads the actual file hash after completion; and calls M2 `recordFileChange`.
- The context gate owns role policy, expected paths, E3 generation, target digest, and before/after hashes.
- Final snapshot comparison excludes only paths whose bridge evidence exactly matches pre/post hashes. Every other change remains unmanaged.

### Mode and scope

`AdapterStartRequest` and `AdapterSession` use `read_only` or `managed_write`. Role `deny` selects read-only; `allow` selects managed write. Do not execute `require_approval` until a verified human-approval source exists.

The first slice permits exactly one normalized `expectedPaths` file. No approved change or a second required change fails the run. The first change invalidates generation and E3; multi-file support requires reinjection or staged runs.

Codex remains in a read-only sandbox, with approval `never` for read-only and `on-request` for managed write. Bridge only a matching single `fileChange` proposal and `item/fileChange/requestApproval`. Reject multi-file changes, moves, unsafe paths, command approvals, and unlinked requests. Report completion only after `item/completed`.

Claude read-only uses `plan` with only `Read`, `Glob`, and `Grep`. Managed write uses `default` with only `Read`, `Glob`, `Grep`, `Write`, and `Edit`. Request approval at PreToolUse and report at PostToolUse or PostToolUseFailure. Do not enable Bash, Agent, Task, external MCP, automatic skills, or filesystem settings.

### Common messages

| Message | Required data |
| --- | --- |
| `managed_write_request` | Common coordinates and `requestedAt` |
| `managed_write_decision` | Common coordinates, `decision`, `reasonCode`, and `decidedAt` |
| `managed_write_completion` | Common coordinates, `status`, and `completedAt` |

Coordinates include adapter, project/run/session/provider session, target/provider turn, provider item, repository-relative path, `targetDigest`, and `changeKind` (`created`, `modified`, `deleted`, or provider-ambiguous `upsert`). An allow decision uses only `reasonCode=authorized`. Denials identify approval, missing bridge, denied capability, invalid request, missing context, or telemetry failure.

These are local control messages, not append-only events. They contain no bytes, diff, command, tool input, or provider error body. `targetDigest` supplies the source-free binding.

### Completion and failure

Bind the actual before-hash immediately before approval. After completion, reread the after-hash and verify create, modify, or delete semantics. Only then atomically record `file.changed` and `context.invalidated` and consume the permit. The final snapshot must confirm the same hashes.

`provider_write_failed` covers missing or failed completion, rejected status, change-kind mismatch, approval without completion, anything other than exactly one change, and snapshot/evidence mismatch. Emit no normal `file.changed` or completion, and do not auto-retry. Extra paths separately produce `unmanaged_change.detected`; retain every concurrent failure in the ledger.

## Consequences

- Codex and Claude can perform one real file change under common path, context, and hash rules.
- Provider approval protocols remain inside adapters while policy and evidence remain provider-neutral.
- Intent, actual bytes, and full repository state are independently checked.
- ADR-0014 further binds turns and session capabilities and separates controllers.
