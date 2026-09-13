# ADR-0395: Resumable native repository work turns

- Status: accepted
- Decision date: 2026-09-10

## Context

Discord `repository_work` previously created a Hub remote command that required pre-existing signed approval and one to sixteen exact managed-host paths. Natural requests such as “investigate this” or “fix this bug” cannot identify paths before inspection. The Hub repeatedly leased these commands without Node acknowledgement until expiry, while the fixed response incorrectly promised that work would start. Hiring registered a child agent's workforce identity without binding its next conversation task to an executable provider session.

The exact-path managed-run contract remains appropriate for reviewed, deterministic changes. It is not an interactive Claude Code or Codex CLI session and must not be presented as one.

## Decision

### Native work boundary

In a locally configured Discord deployment using natural routing, `repository_work` executes on the repository Node instead of entering Hub remote continuation. The configured provider adapter owns a non-interactive native CLI process:

- Codex uses `codex exec` with its workspace-write automatic-review sandbox, adds the exact Git common directory as a repository-owned writable root for Lervo checkpoints, and resumes by exact thread ID under the same boundary.
- Claude uses print-mode Claude Code with automatic permission classification and resumes by exact session ID.

The Node supplies the repository root, model, reasoning effort, bounded timeout, abort signal, and an environment that exposes the running Node executable to CLI launchers. Provider adapters own provider-specific arguments and result parsing. The conversation application depends only on the provider-neutral repository-work port.

Requests instruct the provider to inspect and act immediately instead of promising or queuing work. Ordinary requesters may not request commits, repository-remote creation, or pushes. A mapped human, or an agent already admitted by the configured effect-request authority, may explicitly request one of those exact effects. The provider must observe before execution, execute once, and independently verify afterward rather than blindly retrying an uncertain result.

An admitted turn enables provider-native external-effect mode: Codex retains workspace-write boundaries with network access enabled, while Claude uses its non-interactive permission mode. Application instructions and scoped requester authority continue to prohibit deployment, broad deletion, unrelated publication, and secret disclosure.

The authenticated conversation request and locally reviewed Node configuration admit the native tool turn. They do not manufacture signed exact-path managed-run approval or claim managed-run evidence.

### Durable session and hired-agent context

The Node stores a bounded projection for each integration:

- A session binds the conversation, thread, worker agent, provider, opaque provider-session ID, and update time.
- A turn binds the source event ID, request-content hash, worker, provider, status (`running`, `completed`, or `failed`), bounded failure code, attempt count, provider-session ID, timestamps, and result-artifact reference.
- An active delegate binds the conversation and thread to the most recently hired child agent's ID, explicit display name, role, and provider policy.

SQLite stores no request text, provider output, source body, credential, command transcript, or diff. CAS stores the bounded final Discord result.

Completed source events deduplicate without rerunning provider tools. Separate events with the exact same request-content hash, conversation, thread, worker, and provider coalesce while the first runs and reuse its result for five minutes after completion. Duplicates receive an explicit in-progress or already-completed response and never start another provider process. Different requests remain separate events, execute in arrival order through the interaction worker, and are not silently merged.

Source-event identity validation, running or completed replay inspection, session lookup, duplicate lookup, and turn admission share one immediate SQLite transaction. Replaying the same running source event retains one attempt across database handles and reopening without refreshing its start time. Elapsed time does not prove interrupted work is safe to repeat. The duplicate response reports the admission record but does not promise that an unobserved process remains active or will deliver a result. Identity or content conflicts roll back admission. This adds no table, persisted field, or event and preserves conversation-scoped result privacy.

Later events in the same worker scope resume the exact provider session across process invocations and Node restarts. Legacy hiring without a separately deployable speaker activates the child as the conversation worker, giving its next task an independent session rather than the parent's session. When hiring prepares a distinct child deployment, the parent retains its configured worker identity. Existing delegate rows cannot override that identity, provider, session, or result scope. The child receives work through its own deployment. [Native admission](../../../specifications/coordination/native-repository-work-admission.md) defines the configuration-derived selection and historical replay boundary.

Each integration retains at most 4,096 completed or failed turn rows and 1,024 sessions or delegates. Project artifact policy governs CAS retention.

### Observation and failure meaning

The Node snapshots Git HEAD and dirty-path content digests before and after every provider turn. Responses report only paths proven changed by that comparison and explicitly identify zero observed changes. Provider prose remains provider output, not independently verified managed evidence.

- `running` means the native provider process may be active.
- `completed` requires a final provider result, durable CAS result, session update, turn update, and canonical `conversation.repository_work.completed` event. Successful diagnostics or external effects that do not alter repository bytes record equal before and after revisions and zero changed paths. Changed bytes also require the checkpoint, knowledge, and replica guarantees below.
- `failed` means no successful result was accepted. Repository bytes or external state may still require inspection because a provider process can fail after an effect. Startup or retry never converts a failed or interrupted native effect into managed success.

Provider process, protocol, empty-result, turn, repository-observation, and result-storage failures retain distinct bounded failure codes without provider stderr or request text. The terminal conversation response reports failure instead of acknowledging a queue. Node shutdown aborts an active provider process. Discord typing begins when the turn owner starts relevance or intent resolution and continues through the provider turn.

A message-scoped dispatch or provider failure does not terminate the shared Node conversation supervisor. Durable interaction retry and the terminal-failure response own that event while other bot identities and active work continue. Authentication rejection and invalid runtime configuration remain terminal supervisor failures.

Natural routing defaults to automation depth eight, allowing explicitly mentioned agents to continue a bounded agent-to-agent exchange beyond one reply. An unmentioned agent-authored report does not independently trigger a response. Agents explicitly address the next participant when collaboration is needed. This supports multi-agent work without unsolicited bot chatter after every status report.

### Conversation ownership

Exact participant and role mentions take priority. A unique explicit address establishes bounded in-memory conversation-and-thread stickiness: later unaddressed human turns remain with that interlocutor until another exact address changes ownership. Discord replies to a configured bot or webhook count as exact addresses.

Without stickiness, unaddressed turns use a stable conversation winner instead of selection from the source-message hash. A uniquely configured CEO has higher unaddressed priority, making Tarin the stable general-channel default. A project channel with one PO remains owned by that PO.

## Consequences

Discord can initiate native repository tools and resumable Codex CLI or Claude Code model context without claiming that the older exact-path remote queue performed interactive work. Managed verification, isolated workforce workspaces, assignment integration, and externally consequential effects remain stricter, separate lifecycles.

Native sessions provide a functional replacement path but do not replace managed-run evidence. Installed acceptance records actual provider execution, session resume, Git observation, typing lifetime, and final Discord delivery separately from managed verification claims. [ADR-0396](0396-conflict-safe-repository-replica-continuation.md) adds exact bidirectional working-replica readiness and post-turn lifecycle enforcement without changing that evidence distinction.

## References

- [Native repository work admission](../../../specifications/coordination/native-repository-work-admission.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Durable conversation execution result return](0383-durable-conversation-execution-result-return.md)
- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Approval-bound managed provider Node host](../../execution/providers/0153-managed-provider-node-host.md)
- [Direct provider terminals](../../../architecture/system/managed-execution/direct-provider-terminals.md)
