# ADR-0029: Codex–Claude cross-review and role-specific provider enforcement

Status: `accepted`  
Decision date: 2026-08-19

## Context

The same-provider fixture proved role-separated runs, sessions, provider sessions, and E2/E3. Real Codex and Claude differ in context representation, session IDs, terminal signals, and shutdown. Common runtime must not branch on these differences or validate provider names only after publication. Claude must reread Codex's published proposal rather than inherit Codex conversation or internal state.

## Decision

### Compose real adapters outside common runtime

`DeliberationRuntime` creates no Codex or Claude client. Callers assign a real `CodexAdapter` or `ClaudeAdapter` to each role's `ManagedProviderRunCoordinator`, then provide only common `ManagedProviderRunResult` values.

Codex injects developer-message items into app-server thread/turn; Claude injects the same envelope through Agent SDK context replay. These protocol differences end inside adapters. Runtime consumes identical session, E2/E3, result-artifact, and event coordinates.

### Enforce role provider before publication

After a managed run, verify that `run.session.provider` satisfies the role's fixed or allowlisted `DeliberationPolicy`. Otherwise fail `artifact_publication_failed/provider_not_allowed` before evaluation, permit creation, or deliberation-artifact recording.

The completed `run.completed` remains execution evidence, but its output does not enter deliberation history or convergence.

### Exchange published source, not conversations

After a writing permit, a Codex result becomes a CAS artifact and structured proposal. A receiving-role document is discoverable through a content-hash-bound `SharedContextPublication` and `HandoffBundle`. Claude's independent run/session loader rereads it into E2, and its adapter creates fresh E3.

Never transfer provider cache, prompts, conversations, or reasoning. Artifact predecessor IDs, shared-context IDs, receipts, and evidence events reconstruct history for every provider combination.

### Events, privacy, and failures

Add no event type or field. Adapter lifecycle events represent real provider sessions; `document.loaded` and `context.injected` represent each role's E2/E3; deliberation-artifact events contain common CAS and structured coordinates, not provider formats. Exclude output source, context messages, raw payloads, prompts, tool input, credentials, and reasoning.

- A disallowed provider requires a new role run under policy; do not invoke the evaluator or emit an artifact.
- Context, shared-publication, provider-session, and history mismatches retain ADR-0028 meanings.
- Adapter protocol failures remain provider-run failures and cannot become deliberation artifacts or convergence.

Filesystem CAS/SQLite fixtures run a real Codex proposer, materialize its permitted hash-bound proposal, inject it into an independent Claude reviewer session, record both common artifacts, and finish `no_consensus` when a blocking objection remains. They verify that events contain no output bodies, the hash chain is valid, and provider-policy mismatch does not invoke the evaluator.

## Consequences

Real protocol differences remain adapter-local while common runtime enforces role provider policy and evidence. ADR-0030 connects converged outcomes to knowledge candidates and local trace/doctor.
