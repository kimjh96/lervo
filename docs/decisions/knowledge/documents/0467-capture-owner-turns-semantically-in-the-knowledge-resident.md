# ADR-0467: Capture owner turns semantically in the knowledge resident

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0457](0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (instruction capture and the conversation-decision source)
Amended by: [ADR-0545](capture/0545-apply-owner-stated-rules-without-a-review-command.md) (owner-stated rules apply on the owner host without a review command), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (every captured rule is stored after an independent cross-check; held items are Lervo debt; the review command is removed)
Related: [ADR-0466 cross-host convergence owner](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The owner requires automatic capture of rules, corrections, and decisions from any session, including the Mac terminal and Discord, without owner or agent bookkeeping. On 2026-10-05, an agent stored the correction “never resolve Mac/WSL conflicts by restricting work to one host” in Claude Code's private memory because Lervo lacked automatic capture. Explicit `lervo knowledge instruction intake` also returned `ignored` with `semantic_resolution_failed` for a clear English rule.

Verified causes:

- **Intake timeout:** `groundDurableInstructionRequest` allowed 10 seconds. Mac measurements were 8.4–12.8 seconds with Claude and 19.5 seconds with Codex. The no-capability runner returned `timed_out`, which the adapter reduced to bare `semantic_resolution_failed`. With a longer bound, both providers produced review candidates for the same English request and a Korean variant.
- **Lost failure meaning:** `GroundProductionRequestError` discarded the cause, hiding whether the provider timed out, was unavailable, or returned an invalid proposal. Codex `error` and `turn.failed` events, including “model at capacity,” appeared as capability-policy violations.
- **Snapshot-bound review:** Candidates stored the source snapshot ID, which changes with every event and unrelated file. Candidates reviewed after their creation turn could never apply.
- **No capture path:** ADR-0457 proposed capture through “the deterministic grounding already in `terminal-request-grounding.ts`,” but that module calls a provider and is not deterministic. The owner prohibits keyword and other lexical rule detection. [Semantic grounding](../../../specifications/execution/semantic-grounding.md) and [ADR-0303](../repository/canonicalization/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md) state: “Natural-language keyword maps are not authoritative and must not be introduced for requests such as remembering, documenting, knowledge capture”. A hook-side detector would have to be lexical to meet ADR-0451's no-provider rule.

## Decision

### Observe on the hook, assess in the resident

The hook only records. On `UserPromptSubmit`, it queues the owner's prompt with the preceding agent reply. On `Stop`, it retains that reply for the next prompt and starts a detached resident cycle when turns are queued. Both steps use bounded local file writes measured under `event_commit`, with no provider call or classification. Exclude sessions bound to assignment workspaces: their prompts come from Lervo or another agent.

For configured human participants, the managed conversation path queues the owner's message and the thread's last agent reply before the managed turn resolves. This implements ADR-0457's `conversation_decision` source.

The knowledge resident drains the queue in `instruction_capture`, the first stage of each cycle, before change review. One no-capability provider call per turn assesses meaning rather than words and returns one class:

- `durable_instruction`: a rule for future work in this repository.
- `correction_of_agent_behavior`: a correction that should govern future agent work. The preceding agent turn supplies context for implicit corrections such as “that's not it, don't do that again.”
- `decision`: a settled design, product, or process choice.
- `preference_personal`: the owner's personal workflow preference; never enters shared knowledge.
- `none`: requests, questions, task-scoped directives, quotations, hypotheticals, and complaints.

Rules, corrections, and decisions that are repository rules pass through the existing durable-instruction plan gate. Eligible rules become exact-hash candidates in the existing store with `captureSource` and `captureId` provenance. Rules rejected for scope, risk, or confidence, and all other decisions, are held for the owner with the provider's normalized title and statement. Classification always requires the provider; no keyword, phrase, or regular expression routes a turn.

### Privacy

Owner and agent turn text rests only in `.lervo/state/knowledge/instruction-capture/queue/`: Git-ignored, 0600 files in 0700 directories, limited to 32 records, expiring after 24 hours, and deleted immediately after assessment or three failures. The per-session agent-reply slot retains at most 2 KiB per session, for at most 16 sessions and six hours. Text reaches the provider transiently through process stdin. Events, the candidate store, and the held list contain only digests, identifiers, normalized rule text, and counts, never turns.

Only typed candidates leave a host through the Hub exchange below: normalized rules, proposed Markdown, digests, and provenance. The Hub never receives queue records.

### Budget and measurement

Limits: 4 turns per cycle, 12 per hour, 60 per day, and 32,000 tokens per allowed daily assessment. A budget-skipped turn is kept a day past the next daily reset, so it is delayed, never lost. Spending requires the same reviewed convergence delegation, host admission, and provider pause rules as document freshness. Without delegation, queued turns wait and expire.

Every call records `resource.usage.recorded` with `channel: knowledge_worker`, `stage: instruction_capture`, and the supplied canonical-instruction catalog as loaded documents. Tombstones prevent duplicate assessment when several agents queue a turn.

### Review and application

Captured rules require existing exact review through `lervo knowledge instruction review`; they are not auto-applied. ADR-0457 keeps “review and materialization exact and reviewed” and defers unreviewed automatic apply. ADR-0458 defers automatic promotion without exact review. ADR-0452 requires an authority check for canonical knowledge materialization.

Owner-stated rules are owner-authored, and `docs/instructions/generated/` is Lervo-generated, so automatic application would not overwrite user bytes under invariant 5. The recommendation is automatic application of rules stated verbatim by the owner in the current session, with a one-command undo. That requires amendments to ADR-0457 and ADR-0458; this decision makes neither amendment.

Review binds to the candidate's instruction-catalog digest. Unrelated sources and events no longer stale a candidate; changes to `AGENTS.md` or entries in `docs/instructions/` still block apply.

Applied rules reach every provider through existing paths:

- Claude Code and Codex compact prompts list applied rule titles.
- Managed runs and Discord turns receive `docs/instructions/generated/rule_*.md` under `repository.instructions`.
- `lervo knowledge query` retrieves rules after knowledge lifecycle registration.

The Lervo-managed `AGENTS.md` route block tells agents never to record owner rules in provider-private memory.

### Parity across hosts

Capture behaves identically on every host. Only the step committing repository bytes depends on the [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) convergence owner lease.

- **Assess on the observing host.** Only the host that queued a hook or conversation turn holds its text, so it assesses the turn. Assessment writes no repository bytes, is not convergence work, and does not require the owner lease. A resident cycle on a `waiting_owner`, `unverifiable`, `contended`, `ineligible`, or `yielding` host still runs capture before returning. Capture requires that host's active, unexpired delegation for its provider, shared provider admission, and per-host caps. Without delegation, the host records one `instruction_capture_blocked` attention item and one compact-prompt line instead of silently holding turns.
- **Exchange typed candidates through the Hub.** After each capture stage, a Hub-coordinated host publishes its candidates to `/v1/sync/projects/{projectId}/knowledge-instruction-candidates` and reads every other host's candidates from that route. Each record contains the typed candidate (normalized rule, proposed Markdown, hashes, classification, provenance), publishing host's hash, and resolution; never owner or agent turn text. Records are keyed by proposed Markdown hash, merging the same rule captured on two hosts into one record. Each host imports every open record absent from its local candidate store. Hub event-batch sync is push-only with no read path, so typed records use this route. Each host records exchanges by hash in an audit event.
- **Apply on the owner.** On Hub-coordinated hosts, `lervo knowledge instruction review --decision apply` requires ownership granted by the ADR-0466 fence. The owner writes `docs/instructions/generated/<rule-id>.md` and commits exactly that file as `Lervo Knowledge`, with `Lervo-Instruction-Candidate` and `Lervo-Convergence-Host` trailers. ADR-0466 publication and the replica carry it to every host. A non-owner refuses with `convergence_owner_elsewhere` and names the owner's label; prompt context and the attention item identify where to apply. Any host may reject because rejection writes no repository bytes.
- **Resolve everywhere.** The applying or rejecting host publishes the resolution. At their next exchange, all hosts remove local copies and never import that rule again. A resolution always wins over a later open publish.
- **Without a Hub.** Hosts with no configuration or `standalone` coordination assess, review, and apply locally, writing the generated rule without committing it, as single hosts did before the exchange.

### Deviations from ADR-0457

- The managed turn contract does not gain `knowledgeCandidate`. One resident assessor serves both surfaces with the same semantic classes, leaving conversation output contracts and costs unchanged.
- `knowledge.instruction_candidate.captured` uses `turnDigest`, not `promptDigest`, because the event redaction boundary drops payload keys containing “prompt”.
- Capture begins on `UserPromptSubmit` because `Stop` receives no prompt. `Stop` supplies the agent reply and starts the cycle.

### Intake fixes

Explicit intake uses a 120-second bound. Alongside stable `semantic_resolution_failed`, failure reasons identify the stage: `semantic_resolution_provider_timed_out`, `semantic_resolution_provider_unavailable`, `semantic_resolution_provider_process_failed`, `semantic_resolution_proposal_invalid`, or `semantic_resolution_resolver_failed`.

The grounding instruction specifies repository scope for rules governing agent work in this repository without narrower paths. Codex `error` and `turn.failed` events become provider failures rather than policy violations.

## Events, states, and failure meaning

- `knowledge.instruction_candidate.captured`: `candidateId`, `captureId`, `source` (`terminal_prompt | conversation`), `captureClass` (`durable_instruction | correction_of_agent_behavior | decision`), `turnDigest`, `occurredAt`. Means an exact-review candidate exists, not that the rule is approved or applied.
- `conversation.knowledge_candidate.recorded` (ADR-0457 fields): `conversationEventId`, `agentId` or null, `kind` (`decision | instruction | fact`), `subjectKeyDigest`, `summaryHash`, `candidateId` (an instruction candidate or a held decision's capture ID), `occurredAt`.
- `knowledge.instruction_candidate.exchanged`: `candidateId`, `proposedContentHash`, `ruleId`, `direction` (`published | imported | resolved`), `resolution` (`open | applied | rejected`), `sourceHostHash` (the record publisher or resolution-deciding host), `occurredAt`. Contains only hashes and identifiers; rule text and Markdown remain in the candidate store and Hub record. Failed exchanges record nothing, retain local bookkeeping, and retry every step next cycle. Imports failing candidate validation are skipped.
- Hub `KnowledgeInstructionCandidateRecord` (`@lervo/sync-contract`): typed candidate, proposed Markdown hash and canonical hash, `sourceHostHash`, `resolution`, `resolvedByHostHash`, and timestamps; at most 64 records per repository. Invalid records return `knowledge_instruction_candidate_invalid` (HTTP 400). Hub outages produce `instruction_candidate_hub_unavailable` and only delay exchange. The [specification](../../../specifications/knowledge/instruction-capture.md) defines the route and merge rule.
- `knowledge.instruction_capture.cycle.completed`: `cycleId`, `assessedCount`, `instructionCandidateCount`, `decisionCount` (held decisions and held rules), `ignoredCount`, `personalPreferenceCount`, `coveredCount`, `failedCount`, `expiredCount`, `skippedForBudget`, `usageObserved`, `occurredAt`. Recorded only when a cycle assessed, failed, or expired a turn.
- Queue states: queued; assessed (removed with a tombstone); failed (removed after three attempts and counted in `failedCount`); expired (removed after 24 hours and counted in `expiredCount`). Deferred cycles caused by missing delegation, unavailable capacity, or a paused provider leave turns queued.
- Held items: `decision` or `rule_needs_clarification`, retained for 30 days or until `lervo knowledge instruction capture --dismiss <capture-id>`; at most 16 items.
- Attention kinds: `durable_instruction_candidate`, `captured_decision`, and `instruction_capture_blocked`; all user-owned and nonblocking. `instruction_capture_blocked` occurs once per host with reason `knowledge_authority_unavailable`, queued count, and since when.
- Apply failure `convergence_owner_elsewhere` means a Hub-coordinated non-owner refused to apply and wrote nothing.
- A failed queue write loses only that capture and never blocks the prompt or conversation turn.

## Verification

- **Scripted-provider stage fixtures:** English, Korean, paraphrased, and implicit corrections become candidates; personal preferences and requests do not. Decisions are held with the conversation event. Events contain no turn text, queue files are private, and per-cycle bounds, retries, expiry, tombstones, and missing delegation behave as specified.
- **Hook tests:** Prompts are queued with the preceding reply; events contain neither. Enqueue p95 is under 200 milliseconds. Assignment workspaces are excluded.
- **Cross-provider visibility:** A captured candidate appears in the Codex compact prompt and `lervo application attention`. After review, Claude and Codex compact prompts list the applied rule, and managed context selects it under `repository.instructions`.
- **Cross-host tests:** A Mac turn is assessed on the Mac while WSL owns convergence and is published without turn text. The same rule from two hosts produces one record. WSL imports and applies it as owner with a `Lervo Knowledge` commit; the Mac drops its copy. A non-owner apply names the owner.
- **Natural-language evaluation:** `benchmarks/grounding/instruction-capture-v1.json` contains 28 English and Korean cases, each with one recorded Claude observation. `pnpm evaluation:natural-language:check` requires class agreement of at least 0.8, rule-and-correction recall of at least 0.85, and no non-rule turn proposed as a canonical rule.

## Deferred

Automatic application of owner-stated rules and Discord review commands (ADR-0458).

[ADR-0543](../repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md) adds the preceding turn's bounded work record to each capture call and a separate `practice` output field, so one call captures rules and reusable procedures; it learns portable skills in the resident from completed work.
