# ADR-0327: Keep unmanaged terminal hooks availability-safe

- Status: accepted
- Decision date: 2026-09-01

## Context

The direct `UserPromptSubmit` path combined two independent provider calls: read-only query projection and typed effect grounding. Provider observations showed that effect grounding frequently ended as `semantic_resolution_failed`, delayed bounded retrieval, and provided no authority an unmanaged provider session could safely use. Removing only `UserPromptSubmit` left `Stop` installed, allowing a later Stop with no matching preparation to block a session Lervo had never observed.

Local repository retrieval has a strict source boundary. No current-repository result can establish that a publication is absent from another repository or an external or shared service. Inferring broader absence is a source-scope error regardless of the natural-language term used for the external surface; lexical aliases and translated keywords cannot correct it.

Managed execution differs because Lervo creates the run, binds capabilities and authority, and can enforce its lifecycle before returning a managed result.

## Decision

Direct provider terminal sessions remain `unmanaged`. Their hooks protect provider availability as follows.

### `UserPromptSubmit`

- Perform only provider-neutral query projection and deterministic exact-hash retrieval from registered knowledge in the current repository.
- Do not invoke typed effect grounding, choose a workflow, grant authority, route to another repository or service, or materialize a durable repository instruction.
- Represent this boundary in `terminal.context.prepared` with `groundingStatus: abstain`, empty workflow/source/subject/provider coordinates, and reason `unmanaged_terminal_retrieval_only`.
- State in returned context that an empty or failed local result is not evidence about any other repository or external or shared service.
- After valid bounded hook input, return empty successful hook output if repository discovery, projection, selection, loading, context assembly, event persistence, or receipt persistence fails. The turn then has no prepared-context claim.

This behavior is source-scoped and capability-scoped. It must not depend on product names, synonyms, translations, or user phrases.

### `Stop`

- With no matching prepared context, return empty success without creating completion evidence.
- For a matching direct root-session context, inspect the observable repository lifecycle and record `terminal.turn.observed` when possible. `lifecycleStatus` remains `current` or `action_required`, while `completionResult` is `allowed`; a non-current lifecycle is audit evidence and does not block provider completion.
- If lifecycle inspection or persistence fails, return empty success without an unsupported completion claim.
- Preserve fail-closed blocking for an attached worker workspace whose lease, ownership marker, revision, or path-scoped isolation is not current. This protects an explicitly managed checkout, not ordinary root-session availability.
- For a re-entrant Stop (`stop_hook_active: true`), return empty success immediately.

Malformed or oversized provider input and generated-runtime integrity failure still exit nonzero because the endpoint contract cannot be trusted. Provider hook installation, provider trust, and activation readiness remain separately observable.

### Managed execution

`lervo run`, managed worker operations, approvals, capability activation, and evidence contracts retain fail-closed semantics. Query projection never becomes effect, authority, route, delivery, or use evidence.

## Event, privacy, and failure meaning

No new event type is added.

- `terminal.context.prepared` requires the existing bounded request/query digests, projection receipt, repository snapshot coordinates, selection/loading states, and stable reason `unmanaged_terminal_retrieval_only`. It stores no prompt, projected query text, provider output, credential, or external-service identifier.
- `terminal.turn.observed` may pair `lifecycleStatus: action_required` with `completionResult: allowed` for an unmanaged root session. This means Lervo observed unfinished repository lifecycle work but did not claim authority to stop the provider; it does not mean the lifecycle is current.
- Empty hook success after internal failure means availability was preserved and no preparation or completion evidence was established. It must not be reported as a successful query, injection, use, or lifecycle check.
- Worker `completionResult: blocked` retains its existing bounded workspace coordinates and failure codes.

## Consequences

Ordinary Codex and Claude prompts no longer depend on effect-grounding reliability, and a retained Stop hook cannot deadlock a turn begun without prompt preparation. Local retrieval remains useful without authorizing broader source conclusions. Repository lifecycle gaps remain visible in events and `lervo terminal status`; managed runs and attached worker isolation retain enforceable gates.

## Verification

- Direct prompt tests prove one query-projection call, zero effect-grounding calls, zero automatic durable-rule materializations, bounded local-scope context, and empty success when preparation throws.
- Root Stop tests prove unmatched and non-current turns return empty success, while a recorded non-current turn retains `lifecycleStatus: action_required` and `completionResult: allowed`.
- Worker tests prove writer conflicts and path escape still block.
- Malformed-input and generated-runtime integrity tests remain fail-closed.
- Generated runtime, schema, documentation lifecycle, quality, package, and release-completion checks must pass.

## References

- [Fail-closed provider terminal integration](../0196-fail-closed-provider-terminal-integration.md)
- [Unmanaged terminal context observation](../0197-unmanaged-terminal-context-observation.md)
- [Natural-language terminal finalization](../0200-natural-language-terminal-turn-finalization.md)
- [Self-contained terminal runtime](../0204-self-contained-repository-terminal-hook-runtime.md)
- [Typed semantic grounding](../../grounding/0237-typed-semantic-grounding-and-terminal-stage-evidence.md)
