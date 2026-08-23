# ADR-0029: Codex–Claude cross-review and role-specific provider enforcement

Status: `accepted`
Decision date: 2026-08-19

## Context

The same-provider fixture proved role-separated runs, sessions, provider sessions, and E2/E3. Real Codex and Claude differ in context representation, session IDs, terminal signals, and shutdown. Branching on these differences inside common runtime or checking only provider names after publication would weaken the provider-neutral boundary. Claude must reread Codex's published proposal, not inherit Codex conversation or internal state.

## Decision

### Compose real adapters outside common runtime

`DeliberationRuntime` creates no Codex or Claude client. Callers assign a real `CodexAdapter` or `ClaudeAdapter` to each role's `ManagedProviderRunCoordinator`, then supply only common `ManagedProviderRunResult`.

Codex injects developer-message items into app-server thread/turn; Claude injects the same envelope through Agent SDK context replay. Those protocol differences end inside adapters. Runtime consumes identical session, E2/E3, result-artifact, and event coordinates.

### Enforce role provider before publication

After a managed run, first check whether its `run.session.provider` satisfies that role's fixed/allowlisted `DeliberationPolicy`. Otherwise fail `artifact_publication_failed/provider_not_allowed` before writing evaluation, permit creation, or deliberation-artifact recording.

The already completed `run.completed` remains execution evidence, but its output never enters deliberation history or convergence.

### Exchange published source, not conversations

After a writing permit, a Codex result becomes a CAS artifact and structured proposal. A receiving-role document is discoverable through a content-hash-bound `SharedContextPublication` and `HandoffBundle`. Claude's own run/session loader rereads it into E2 and its adapter produces fresh E3.

Never hand off provider cache, prompts, conversations, or reasoning. Across any provider combination, artifact predecessor IDs, shared-context IDs, receipts, and evidence events reconstruct history.

### Events, privacy, and failures

Add no event type or field. Adapter lifecycle events represent actual provider sessions; `document.loaded`/`context.injected` represent each role's own E2/E3; deliberation-artifact events record common CAS/structured coordinates, not provider formats. Exclude output source, context messages, raw payloads, prompts, tool input, credentials, and reasoning.

- Disallowed providers require a new role run under policy; do not call the evaluator or emit an artifact.
- Context, shared-publication, provider-session, and history mismatches retain ADR-0028 meanings.
- Adapter protocol failures remain provider-run failures and cannot become deliberation artifacts or convergence.

Filesystem CAS/SQLite fixtures execute a real Codex proposer, materialize its permitted hash-bound proposal, inject it into an independent Claude reviewer session, record both common artifacts, and finish `no_consensus` on an unresolved blocking objection. They verify no output bodies in events, a valid hash chain, and evaluator non-invocation for a provider-policy mismatch.

## Consequences

Real protocol differences remain adapter-local while common runtime enforces role provider policy and evidence. ADR-0030 connects converged outcomes to knowledge candidates and local trace/doctor.
