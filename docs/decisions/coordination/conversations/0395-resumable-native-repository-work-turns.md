# ADR-0395: Resumable native repository work turns

- Status: accepted (amended 2026-09-23)
- Decision date: 2026-09-10
- Amended by: [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md), [ADR-0454](agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md)

## Context

Discord `repository_work` previously created a Hub remote command requiring pre-existing signed approval and one to sixteen exact managed-host paths. Natural requests such as “investigate this” or “fix this bug” cannot identify paths before inspection. The Hub repeatedly leased commands without Node acknowledgement until expiry, while the fixed response incorrectly promised work would start. Hiring registered a child's workforce identity without binding its next conversation task to an executable provider session.

The exact-path managed-run contract remains appropriate for reviewed, deterministic changes. It is not an interactive Claude Code or Codex CLI session and must not be presented as one.

## Decision

### Native work boundary

In locally configured Discord deployments using natural routing, `repository_work` executes on the repository Node rather than entering Hub remote continuation. The configured provider adapter owns a non-interactive native CLI process:

- Codex uses `codex exec` with its workspace-write automatic-review sandbox, adds the exact Git common directory as a repository-owned writable root for Lervo checkpoints, and resumes by exact thread ID under the same boundary.
- Claude uses print-mode Claude Code with automatic permission classification and resumes by exact session ID.

Claude print-mode `stream-json` requires `--verbose`. The adapter keeps these arguments together; its native-boundary test rejects a missing flag before accepting a streamed result. Before Node distribution activation, an installed provider smoke check must exercise the actual CLI contract. Fake-process tests alone do not establish CLI compatibility.

The first terminal Claude `result` event ends parsing. Malformed output before it fails the protocol; later non-protocol provider diagnostics cannot reverse a terminal result. The adapter still verifies the exact session ID and rejects provider-reported errors.

If a successful, exact-session Claude result omits its answer, the adapter first uses the last complete streamed assistant answer. If that is also absent, it may read only that session's bounded local Claude transcript tail and accept a non-sidechain `end_turn` answer written during the current process lifetime for the exact repository root. A later user request or tool call invalidates the candidate. Provider errors, unsuccessful terminal results, stale answers, and missing transcripts fail closed. The adapter neither starts another model turn nor replays repository effects.

The Node supplies the repository root, model, reasoning effort, bounded timeout, abort signal, and an environment exposing the running Node executable to CLI launchers. Adapters own provider-specific arguments and result parsing. The conversation application depends only on the provider-neutral repository-work port.

The default inactivity timeout is thirty minutes. Only provider-native structured progress renews that window; arbitrary stderr, unparseable output, and process liveness do not. An independent absolute bound is three times the inactivity timeout, capped at ninety minutes. Codex JSON events and Claude stream-JSON messages supply progress without granting providers deadline authority. Instructions bind an earlier exact finalization-start time, require the first bounded checkpoint immediately after the first material edit, and reserve remaining time for exact-state checkpoint refresh, required checks, and a truthful bounded result. The absolute bound provides recovery headroom for an active turn; it does not justify deferring planned finalization.

After a successful changed-path result, the Node may advance the exact unchanged baseline workstream once before completion gates. It never recovers a missing, switched, settled, or failed turn. Providers still checkpoint early for crash safety. The [provider-execution contract](../../../distribution/node-runtime-distribution/discord-configuration/execution/native-work/provider-execution.md) owns the exact boundary.

### Task-aware quality and provider allocation

The single managed conversation turn semantically classifies admitted repository work as `routine`, `reasoning`, or `review`, without keyword matching. The primary requested deliverable determines the class, not incidental planning, code reading, debugging, or checks:

- `routine`: bounded mechanical work, ordinary implementation, and standard checks.
- `reasoning`: architecture, design, planning, genuinely ambiguous diagnosis, and consequential judgment when they are the deliverable or materially determine the solution.
- `review`: independent verification, audit, critique, and acceptance rather than ordinary implementation checks.

Risk and quality take priority over cost.

Optional `remoteCommands.providerHost.executionProfiles` maps every class to one preferred provider and provider-specific model and reasoning-effort routes. `reasoning` and `review` require at least `high` effort; `routine` requires `low` or `medium`. When both providers are installed, reasoning and review profiles must prefer different providers to avoid concentrating review in one provider family. Allocation follows semantic responsibility, not sums of raw token counts from unlike provider accounting systems.

A named agent's explicit provider binding takes precedence over profile preference. Otherwise, each new source event uses its semantic profile's preferred provider, even if another provider handled an earlier event. The Node retains separate opaque sessions for each conversation, thread, worker, and provider, preserving implementation or reasoning sessions when switching for independent review. Replay of an admitted source event retains its original provider and fails closed on changed identity; it never reroutes or repeats the effect.

Without a semantic profile, the most recently used provider remains the legacy continuity preference before the configured default. Every selected profile must contain a quality-preserving route for its provider or execution fails closed. Static `models` and `reasoningEfforts` remain the backward-compatible route when no semantic profile exists.

Installed product-owner fleets use one reviewed deployment model policy for equivalent work classes, not per-agent names or a core hardcoded model. The policy may use a stronger medium-effort baseline for ordinary work and reserve cheaper models for separately classified, genuinely high-volume production. Model replacement changes requested routes only; provider access and observed usage require installed checks. Existing single-provider session rows migrate transactionally to the provider-qualified key before admission. Migration failure prevents Node startup without rewriting a session; session IDs remain local and opaque.

Completion evidence records the semantic profile, allocation reason (`session_continuity`, `bound_agent_provider`, `profile_preference`, or `configured_default`), requested model, and requested effort. These establish routing, not the provider-observed model or answer quality. A null profile denotes legacy or static routing. Provider-native usage remains separately attributable; no cross-provider normalized token total is invented.

Requests instruct providers to inspect and act immediately instead of promising or queuing work. Ordinary requesters may not request commits, repository-remote creation, pushes, or deployments. A mapped human, or an agent already admitted by configured effect-request authority, may explicitly request one of those exact effects. The provider must observe before execution, execute once, and independently verify afterward rather than blindly retry an uncertain result. Deployment also binds an exact target, rollback, current runtime and authority checks, and installed verification. It cannot infer risk expansion, kill-switch reset, or credential changes.

An admitted turn enables provider-native external-effect mode: Codex retains workspace-write boundaries with network access enabled; Claude uses its non-interactive permission mode. Application instructions and scoped requester authority still prohibit broad deletion, unrelated publication, and secret disclosure. These instructions are not an operating-system deployment sandbox.

The authenticated conversation request and locally reviewed Node configuration admit the native tool turn. They neither manufacture signed exact-path managed-run approval nor claim managed-run evidence.

### Durable session and hired-agent context

The Node stores a bounded projection per integration:

- A session binds conversation, thread, worker agent, provider, opaque provider-session ID, and update time. Provider is part of the unique key; session IDs are never reused across providers.
- A turn binds source event ID, request-content hash, worker, provider, status (`running`, `completed`, or `failed`), bounded failure code, attempt count, provider-session ID, timestamps, and result-artifact reference.
- An active delegate binds conversation and thread to the most recently hired child's ID, explicit display name, role, and provider policy.

SQLite stores no request text, provider output, source body, credential, command transcript, or diff. CAS stores the bounded final Discord result.

Completed source events deduplicate by exact source-event identity without rerunning provider tools. Separately authored events remain distinct even if text and content hash match. Exact completed replay republishes stored provider output; exact running replay is held for reconciliation without fixed duplicate prose.

Source-event identity validation, running or completed replay inspection, session lookup, and turn admission share one immediate SQLite transaction. Replay of the same running source event retains one attempt across database handles and reopening, without refreshing its start time. Elapsed time does not prove interrupted work safe to repeat. Identity or content conflicts roll back admission. This adds no table, persisted field, or event and preserves conversation-scoped result privacy.

Canonical completion precedes the local turn projection. Restart recovery follows [the exact reconciliation contract](../../../specifications/coordination/native-repository-work-recovery.md); it neither replays provider work nor publishes at startup.

Later events in the same worker scope resume the exact provider session across process invocations and Node restarts. Legacy hiring without a separately deployable speaker activates the child as conversation worker, giving its next task an independent session rather than the parent's. When hiring prepares a distinct child deployment, the parent retains its configured worker identity. Existing delegate rows cannot override that identity, provider, session, or result scope. The child receives work through its own deployment. [Native admission](../../../specifications/coordination/native-repository-work-admission.md) defines configuration-derived selection and the historical replay boundary.

Each integration retains at most 4,096 completed or failed turn rows and 1,024 sessions or delegates. Project artifact policy governs CAS retention.

### Observation and failure meaning

The Node snapshots Git HEAD and dirty-path content digests before and after every provider turn. Responses report only paths proven changed by comparison and explicitly identify zero observed changes. Provider prose remains provider output, not independently verified managed evidence.

- `running`: the native provider process may be active.
- `completed`: requires a final provider result, durable CAS result, and canonical completion event. The local session and turn projection normally commits immediately afterward; restart may reconstruct only the exact matching completed projection from canonical evidence. Zero-change work records equal revisions. Changed bytes require checkpoint, knowledge, and configured replica guarantees. New events optionally record bounded `checkpointDisposition`; historical events remain compatible.
- `failed`: no successful result was accepted. Repository bytes or external state may still require inspection because a process can fail after an effect. Startup or retry never converts failed or interrupted native effects into managed success.

Provider, deadline, observation, and storage failures retain bounded codes without native prose. A deadline is always `provider_turn_timeout`; intermediate output is not a result. Effects may precede failure, so uncertainty is inspected rather than replayed. An unresolved post-effect gate is nonretryable `response_effect_unconfirmed`. Shutdown aborts the process; typing spans the owned lifecycle.

A message-scoped dispatch or provider failure does not terminate the shared Node conversation supervisor. Durable interaction retry and the terminal-failure response own that event while other bot identities and active work continue. Authentication rejection and invalid runtime configuration remain terminal supervisor failures.

Natural routing defaults to automation depth eight, allowing explicitly mentioned agents a bounded exchange beyond one reply. An unmentioned agent-authored report does not independently trigger a response. Agents explicitly address the next participant when collaboration is needed, allowing multi-agent work without unsolicited replies to every status report.

### Conversation ownership

Exact participant and role mentions take priority. A unique human-authored explicit address establishes bounded durable conversation-and-thread focus: later unaddressed human turns remain with that interlocutor until another exact human address changes ownership. Hiring, assignment, provider output, and agent-authored messages cannot steal focus. Discord replies to a configured bot or webhook count as exact addresses. Restart and co-resident hiring reconfiguration retain focus; missing or idle participants fall back to one deterministic current owner.

Without stickiness, unaddressed turns use a stable conversation winner rather than the source-message hash. A uniquely configured CEO has higher unaddressed priority, making Tarin the stable general-channel default. A project channel with one PO remains owned by that PO.

## Consequences

Discord can initiate native repository tools and resumable Codex CLI or Claude Code context without claiming the older exact-path remote queue performed interactive work. Managed verification, isolated workforce workspaces, assignment integration, and externally consequential effects remain stricter, separate lifecycles.

Native sessions provide a functional replacement path without replacing managed-run evidence. Installed acceptance records actual provider execution, session resume, Git observation, typing lifetime, and final Discord delivery separately from managed verification claims. [ADR-0396](../sync/0396-conflict-safe-repository-replica-continuation.md) adds exact bidirectional working-replica readiness and post-turn lifecycle enforcement without changing that evidence distinction.

## References

- [Native repository work admission](../../../specifications/coordination/native-repository-work-admission.md)
- [Native repository work recovery](../../../specifications/coordination/native-repository-work-recovery.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Durable conversation execution result return](0383-durable-conversation-execution-result-return.md)
- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Approval-bound managed provider Node host](../../execution/providers/0153-managed-provider-node-host.md)
- [Direct provider terminals](../../../architecture/system/managed-execution/direct-provider-terminals.md)
