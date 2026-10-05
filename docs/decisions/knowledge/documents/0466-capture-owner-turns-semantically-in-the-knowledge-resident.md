# ADR-0466: Capture owner turns semantically in the knowledge resident

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0457](0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (instruction capture and the conversation-decision source)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The owner requires Lervo to capture rules, corrections, and decisions stated in any session, on the Mac terminal or through Discord, without the agent or the owner running bookkeeping. On 2026-10-05 an agent recorded an owner correction ("never resolve Mac/WSL conflicts by restricting work to one host") in Claude Code's private memory because Lervo had no automatic path. The explicit path failed as well: `lervo knowledge instruction intake` returned `ignored` with `semantic_resolution_failed` for a clear English rule.

Verified causes:

- **Intake timeout.** `groundDurableInstructionRequest` gave the provider 10 seconds. Measured on the Mac, one durable-instruction grounding took 8.4 to 12.8 seconds with Claude and 19.5 seconds with Codex, so the no-capability runner returned `timed_out` and the adapter collapsed it into a bare `semantic_resolution_failed`. With a longer bound, the same English request and a Korean variant produced review candidates on both providers.
- **Lost failure meaning.** `GroundProductionRequestError` discarded the cause, so the intake result could not say whether the provider timed out, was unavailable, or returned an invalid proposal. Codex `error` and `turn.failed` events, such as "model at capacity", surfaced as a capability-policy violation.
- **Review bound to the whole snapshot.** A candidate stored the source snapshot ID, which changes with every event and unrelated file. A candidate reviewed later than the same turn could never apply.
- **No capture path.** ADR-0457 planned capture through "the deterministic grounding already in `terminal-request-grounding.ts`". That module calls a provider, so it is not deterministic, and the owner has prohibited keyword or other lexical rule detection (see [semantic grounding](../../../specifications/execution/semantic-grounding.md) and [ADR-0303](../repository/canonicalization/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md): "Natural-language keyword maps are not authoritative and must not be introduced for requests such as remembering, documenting, knowledge capture"). A hook-side detector would have to be lexical to fit ADR-0451's no-provider rule.

## Decision

### Observe on the hook, assess in the resident

The hook path only records. On `UserPromptSubmit`, the terminal hook queues the owner's prompt with the agent reply that preceded it; on `Stop`, it keeps that reply as context for the next prompt and starts a detached resident cycle when turns are queued. Both steps are bounded local file writes, measured under the existing `event_commit` stage, with no provider call and no classification. Sessions bound to an assignment workspace are excluded because their prompts come from Lervo or another agent.

The managed conversation path does the same for configured human participants: before the managed turn resolves, the owner's message and the last agent reply in the thread are queued. This is the ADR-0457 `conversation_decision` source.

The knowledge resident drains the queue in a new `instruction_capture` stage that runs first in each cycle, before change review. One no-capability provider call per turn assesses meaning, not words, and returns one class:

- `durable_instruction`: a rule for future work in this repository.
- `correction_of_agent_behavior`: a correction of how the agent worked that should govern future work; the preceding agent turn makes implicit corrections such as "that's not it, don't do that again" understandable.
- `decision`: a settled design, product, or process choice.
- `preference_personal`: the owner's personal workflow preference. It never enters shared knowledge.
- `none`: requests, questions, task-scoped directives, quotations, hypotheticals, and complaints.

Rules and corrections, and decisions that are themselves repository rules, pass through the existing durable-instruction plan gate. A gate-eligible rule becomes an exact-hash candidate in the existing store, with `captureSource` and `captureId` provenance. A rule the gate rejects for scope, risk, or confidence, and every other decision, is held for the owner with the provider's normalized title and statement. Nothing is classified without the provider; no keyword, phrase, or regular expression routes a turn.

### Privacy

Owner and agent turn text rests only in `.lervo/state/knowledge/instruction-capture/queue/`: Git-ignored, 0600 files in 0700 directories, at most 32 records, expiring after 24 hours, and deleted as soon as the turn is assessed or fails three times. The per-session agent-reply slot keeps at most 2 KiB, at most 16 sessions, for six hours. The provider receives the text transiently through process stdin. Events, the candidate store, and the held list contain digests, identifiers, normalized rule text, and counts, never the turns.

### Budget and measurement

The stage assesses at most 4 turns per cycle, 12 per hour, 60 per day, and 200,000 provider tokens per day. Spend requires the same reviewed convergence delegation, host admission, and provider pause rules as document freshness. Without delegation the turns wait in the queue and expire. Every call records `resource.usage.recorded` with `channel: knowledge_worker` and `stage: instruction_capture`, plus the supplied canonical-instruction catalog as loaded documents. Tombstones keep a turn from being assessed twice when several agents queue it.

### Review and application

Captured rules wait for the existing exact review (`lervo knowledge instruction review`). They are not auto-applied. ADR-0457 keeps "review and materialization exact and reviewed" and defers unreviewed automatic apply; ADR-0458 defers automatic promotion without exact review; ADR-0452 places canonical knowledge materialization at an authority check. Owner-stated rules are owner-authored and the target, `docs/instructions/generated/`, is Lervo-generated, so automatic application would not overwrite user bytes under invariant 5. The recommendation is to auto-apply rules the owner stated verbatim in the current session, with a one-command undo; that requires an amendment to ADR-0457 and ADR-0458 that this decision does not make.

Review binds to the instruction-catalog digest recorded on the candidate, so unrelated sources and events no longer stale it. A changed `AGENTS.md` or `docs/instructions/` entry still blocks apply.

Applied rules reach every provider through existing paths: the compact prompt lists applied rule titles for Claude Code and Codex alike, managed runs and Discord turns receive `docs/instructions/generated/rule_*.md` under the `repository.instructions` rule, and `lervo knowledge query` retrieves them after the knowledge lifecycle registers them. The Lervo-managed `AGENTS.md` route block tells agents never to record owner rules in provider-private memory.

### Deviations from ADR-0457

- The managed turn contract does not gain `knowledgeCandidate`. The resident's one assessor serves both surfaces, so a conversation turn's output contract and cost do not change, and both surfaces get the same semantic classes.
- `knowledge.instruction_candidate.captured` carries `turnDigest`, not `promptDigest`: the event redaction boundary drops any payload key containing "prompt".
- Capture starts on `UserPromptSubmit` because `Stop` does not receive the prompt; `Stop` contributes the agent reply and starts the cycle.

### Intake fixes

Explicit intake uses a 120-second bound, and failure reasons name the stage: `semantic_resolution_provider_timed_out`, `semantic_resolution_provider_unavailable`, `semantic_resolution_provider_process_failed`, `semantic_resolution_proposal_invalid`, or `semantic_resolution_resolver_failed`, beside the stable `semantic_resolution_failed`. The grounding instruction states that a rule governing how agents work in this repository, without narrower paths, has repository scope. Codex `error` and `turn.failed` events become a provider failure, not a policy violation.

## Events, states, and failure meaning

- `knowledge.instruction_candidate.captured`: `candidateId`, `captureId`, `source` (`terminal_prompt | conversation`), `captureClass` (`durable_instruction | correction_of_agent_behavior | decision`), `turnDigest`, `occurredAt`. It means an exact-review candidate exists; it does not mean the rule is approved or applied.
- `conversation.knowledge_candidate.recorded` (ADR-0457 fields): `conversationEventId`, `agentId` or null, `kind` (`decision | instruction | fact`), `subjectKeyDigest`, `summaryHash`, `candidateId` (an instruction candidate or the capture ID of a held decision), `occurredAt`.
- `knowledge.instruction_capture.cycle.completed`: `cycleId`, `assessedCount`, `instructionCandidateCount`, `decisionCount` (held decisions and held rules), `ignoredCount`, `personalPreferenceCount`, `coveredCount`, `failedCount`, `expiredCount`, `skippedForBudget`, `usageObserved`, `occurredAt`. It is recorded only when a cycle assessed, failed, or expired a turn.
- Queue states: queued, assessed (removed with a tombstone), failed (removed after three attempts, counted in `failedCount`), expired (removed after 24 hours, counted in `expiredCount`). A deferred cycle (no delegation, no capacity, or a paused provider) leaves turns queued.
- Held items: `decision` or `rule_needs_clarification`, kept 30 days or until `lervo knowledge instruction capture --dismiss <capture-id>`; at most 16.
- Attention kinds: `durable_instruction_candidate` and `captured_decision`, both owned by the user and never blocking.
- A failed queue write loses only that capture and never blocks the prompt or the conversation turn.

## Verification

- Stage fixtures with a scripted provider: English, Korean, paraphrased, and implicit corrections become candidates; personal preferences and requests do not; decisions are held with the conversation event; no event contains turn text; queue files are private; the per-cycle bound, retries, expiry, tombstones, and missing delegation behave as specified.
- Hook tests: prompts are queued with the preceding reply, events contain neither, the enqueue p95 is under 200 milliseconds, and assignment workspaces are excluded.
- Cross-provider visibility: a captured candidate appears in the Codex compact prompt and in `lervo application attention`; after review, Claude and Codex compact prompts list the applied rule, and managed context selects it under `repository.instructions`.
- Natural-language evaluation: `benchmarks/grounding/instruction-capture-v1.json` holds 28 English and Korean cases with one recorded Claude observation each; `pnpm evaluation:natural-language:check` requires at least 0.8 class agreement, at least 0.85 recall of rules and corrections, and no non-rule turn proposed as a canonical rule.

## Deferred

Automatic application of owner-stated rules, Discord review commands (ADR-0458), and the cross-host single convergence owner (ADR-0457).
