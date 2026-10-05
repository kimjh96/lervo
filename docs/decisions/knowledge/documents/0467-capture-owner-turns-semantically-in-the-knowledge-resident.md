# ADR-0467: Capture owner turns semantically in the knowledge resident

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0457](0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (instruction capture and the conversation-decision source)
Related: [ADR-0466 cross-host convergence owner](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md)
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

Only typed candidates leave a host, through the Hub exchange described below: the normalized rule, its proposed Markdown, digests, and provenance. The Hub never receives queue records.

### Budget and measurement

The stage assesses at most 4 turns per cycle, 12 per hour, 60 per day, and 200,000 provider tokens per day. Spend requires the same reviewed convergence delegation, host admission, and provider pause rules as document freshness. Without delegation the turns wait in the queue and expire. Every call records `resource.usage.recorded` with `channel: knowledge_worker` and `stage: instruction_capture`, plus the supplied canonical-instruction catalog as loaded documents. Tombstones keep a turn from being assessed twice when several agents queue it.

### Review and application

Captured rules wait for the existing exact review (`lervo knowledge instruction review`). They are not auto-applied. ADR-0457 keeps "review and materialization exact and reviewed" and defers unreviewed automatic apply; ADR-0458 defers automatic promotion without exact review; ADR-0452 places canonical knowledge materialization at an authority check. Owner-stated rules are owner-authored and the target, `docs/instructions/generated/`, is Lervo-generated, so automatic application would not overwrite user bytes under invariant 5. The recommendation is to auto-apply rules the owner stated verbatim in the current session, with a one-command undo; that requires an amendment to ADR-0457 and ADR-0458 that this decision does not make.

Review binds to the instruction-catalog digest recorded on the candidate, so unrelated sources and events no longer stale it. A changed `AGENTS.md` or `docs/instructions/` entry still blocks apply.

Applied rules reach every provider through existing paths: the compact prompt lists applied rule titles for Claude Code and Codex alike, managed runs and Discord turns receive `docs/instructions/generated/rule_*.md` under the `repository.instructions` rule, and `lervo knowledge query` retrieves them after the knowledge lifecycle registers them. The Lervo-managed `AGENTS.md` route block tells agents never to record owner rules in provider-private memory.

### Parity across hosts

Capture works the same on every host. No part of it depends on which host holds the [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) convergence owner lease, except the one step that commits repository bytes.

- **Assess where the turn was observed.** The host whose hook or conversation runtime queued a turn is the only host that holds its text, so that host assesses it. Assessment writes no repository bytes, so it is not convergence work and is not gated on the owner lease: a resident cycle on a `waiting_owner`, `unverifiable`, `contended`, `ineligible`, or `yielding` host still runs the capture stage before it returns. The stage still requires that host's own authority and budget: an active, unexpired delegation for its provider, the shared provider admission, and the per-host caps. A host without delegation records one `instruction_capture_blocked` attention item and one compact-prompt line instead of holding turns silently; its turns expire after 24 hours as before.
- **Exchange typed candidates through the Hub.** A Hub-coordinated host publishes each candidate it created to `/v1/sync/projects/{projectId}/knowledge-instruction-candidates` and reads every other host's candidates from the same route, after each capture stage. A record holds the typed candidate (normalized rule, proposed Markdown, hashes, classification, provenance), the publishing host's hash, and a resolution. It never holds owner or agent turn text. Records are keyed by the proposed Markdown hash, so the same rule captured on two hosts is one record. A host imports every open record it does not hold into its local candidate store. The Hub's event-batch sync is push-only and has no read path, so the typed record travels through this route; an event on each host records the exchange by hash for audit.
- **Apply on the owner.** On a Hub-coordinated host, `lervo knowledge instruction review --decision apply` requires the ADR-0466 fence to grant ownership. The owner writes `docs/instructions/generated/<rule-id>.md` and commits exactly that file as `Lervo Knowledge` with the `Lervo-Instruction-Candidate` and `Lervo-Convergence-Host` trailers, so ADR-0466 publication and the replica carry it to every host. On a non-owner host the command refuses with `convergence_owner_elsewhere` and names the owner's label; the prompt context and attention item say where to apply. Rejection writes no repository bytes, so any host may reject.
- **Resolve everywhere.** The applying or rejecting host publishes the resolution. Every host removes its local copy at its next exchange and never imports that rule again, and a resolution always wins over a later open publish.
- **Without a Hub.** A host with no configuration or with `standalone` coordination assesses, reviews, and applies locally, writing the generated rule without committing it, exactly as a single host did before this exchange existed.

### Deviations from ADR-0457

- The managed turn contract does not gain `knowledgeCandidate`. The resident's one assessor serves both surfaces, so a conversation turn's output contract and cost do not change, and both surfaces get the same semantic classes.
- `knowledge.instruction_candidate.captured` carries `turnDigest`, not `promptDigest`: the event redaction boundary drops any payload key containing "prompt".
- Capture starts on `UserPromptSubmit` because `Stop` does not receive the prompt; `Stop` contributes the agent reply and starts the cycle.

### Intake fixes

Explicit intake uses a 120-second bound, and failure reasons name the stage: `semantic_resolution_provider_timed_out`, `semantic_resolution_provider_unavailable`, `semantic_resolution_provider_process_failed`, `semantic_resolution_proposal_invalid`, or `semantic_resolution_resolver_failed`, beside the stable `semantic_resolution_failed`. The grounding instruction states that a rule governing how agents work in this repository, without narrower paths, has repository scope. Codex `error` and `turn.failed` events become a provider failure, not a policy violation.

## Events, states, and failure meaning

- `knowledge.instruction_candidate.captured`: `candidateId`, `captureId`, `source` (`terminal_prompt | conversation`), `captureClass` (`durable_instruction | correction_of_agent_behavior | decision`), `turnDigest`, `occurredAt`. It means an exact-review candidate exists; it does not mean the rule is approved or applied.
- `conversation.knowledge_candidate.recorded` (ADR-0457 fields): `conversationEventId`, `agentId` or null, `kind` (`decision | instruction | fact`), `subjectKeyDigest`, `summaryHash`, `candidateId` (an instruction candidate or the capture ID of a held decision), `occurredAt`.
- `knowledge.instruction_candidate.exchanged`: `candidateId`, `proposedContentHash`, `ruleId`, `direction` (`published | imported | resolved`), `resolution` (`open | applied | rejected`), `sourceHostHash` (the host that published the record or decided the resolution), `occurredAt`. Hashes and identifiers only; rule text and Markdown stay in the candidate store and the Hub record. Failure meaning: a failed exchange records nothing, keeps local bookkeeping, and retries every step at the next cycle; an import that fails candidate validation is skipped.
- Hub record `KnowledgeInstructionCandidateRecord` (`@lervo/sync-contract`): the typed candidate, its proposed Markdown hash and canonical hash, `sourceHostHash`, `resolution`, `resolvedByHostHash`, and timestamps; at most 64 per repository. An invalid record is `knowledge_instruction_candidate_invalid` (HTTP 400); a Hub outage is `instruction_candidate_hub_unavailable` and only delays the exchange. The [specification](../../../specifications/knowledge/instruction-capture.md) gives the route and merge rule.
- `knowledge.instruction_capture.cycle.completed`: `cycleId`, `assessedCount`, `instructionCandidateCount`, `decisionCount` (held decisions and held rules), `ignoredCount`, `personalPreferenceCount`, `coveredCount`, `failedCount`, `expiredCount`, `skippedForBudget`, `usageObserved`, `occurredAt`. It is recorded only when a cycle assessed, failed, or expired a turn.
- Queue states: queued, assessed (removed with a tombstone), failed (removed after three attempts, counted in `failedCount`), expired (removed after 24 hours, counted in `expiredCount`). A deferred cycle (no delegation, no capacity, or a paused provider) leaves turns queued.
- Held items: `decision` or `rule_needs_clarification`, kept 30 days or until `lervo knowledge instruction capture --dismiss <capture-id>`; at most 16.
- Attention kinds: `durable_instruction_candidate`, `captured_decision`, and `instruction_capture_blocked` (one per host, reason `knowledge_authority_unavailable`, with the queued count and since when), all owned by the user and never blocking.
- Apply failure `convergence_owner_elsewhere`: a Hub-coordinated host that does not own convergence refused to apply; nothing was written.
- A failed queue write loses only that capture and never blocks the prompt or the conversation turn.

## Verification

- Stage fixtures with a scripted provider: English, Korean, paraphrased, and implicit corrections become candidates; personal preferences and requests do not; decisions are held with the conversation event; no event contains turn text; queue files are private; the per-cycle bound, retries, expiry, tombstones, and missing delegation behave as specified.
- Hook tests: prompts are queued with the preceding reply, events contain neither, the enqueue p95 is under 200 milliseconds, and assignment workspaces are excluded.
- Cross-provider visibility: a captured candidate appears in the Codex compact prompt and in `lervo application attention`; after review, Claude and Codex compact prompts list the applied rule, and managed context selects it under `repository.instructions`.
- Cross-host tests: a Mac turn is assessed on the Mac while WSL owns convergence and published without turn text; one rule from two hosts is one record; WSL imports, applies as owner with a `Lervo Knowledge` commit, and the Mac drops its copy; a non-owner apply names the owner.
- Natural-language evaluation: `benchmarks/grounding/instruction-capture-v1.json` holds 28 English and Korean cases with one recorded Claude observation each; `pnpm evaluation:natural-language:check` requires at least 0.8 class agreement, at least 0.85 recall of rules and corrections, and no non-rule turn proposed as a canonical rule.

## Deferred

Automatic application of owner-stated rules, and Discord review commands (ADR-0458).
