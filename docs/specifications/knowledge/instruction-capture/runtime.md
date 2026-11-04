# Instruction-capture runtime

## Entry points

| Surface | Module | Owner turn | Preceding agent turn |
| --- | --- | --- | --- |
| Claude Code, Codex | `apps/cli/src/terminal-instruction-capture.ts` | `UserPromptSubmit` prompt | Session's last `Stop` reply, at most 2 KiB |
| Managed conversation | `apps/node-runtime/src/conversation-owner-turn-capture.ts` | Human participant's message | Last agent reply in the thread |

Sessions bound to an assignment workspace and agent messages are not captured. The hook measures enqueue under `event_commit`, calls no provider, and classifies nothing. `Stop` starts a detached `knowledge-worker` cycle when turns are queued. The queue listing also wakes the resident through the ADR-0461 fingerprint.

## Queue and state

All paths below are under `.lervo/state/knowledge/instruction-capture/`.

| Path | Content | Bound |
| --- | --- | --- |
| `queue/kcap_<24 hex>.json` | Owner turn, preceding agent turn, `promptDigest`, source, conversation event ID | 32 records; 24 hours; deleted when assessed |
| `agent-turns/<24 hex>.json` | Last agent reply for one terminal session | 16 sessions; 2 KiB each; 6 hours |
| `state.json` | Budget windows, assessed tombstones, held decisions and rules with normalized text | 256 tombstones for 7 days; 16 held items for 30 days |

Files are 0600 in 0700 directories and Git-ignored. The capture ID binds the source, owner-turn digest, preceding-turn digest, and conversation event ID: multiple agents queueing the same message produce one record. A full queue evicts its oldest record.

## Assessment

`runInstructionCaptureCycle` in `packages/repository-knowledge-runtime/src/instruction-capture-stage.ts` runs first in `runAutonomousKnowledgeWorker`. Failure leaves the queue for the next cycle and blocks no other stage.

For each turn, it sends `instructionCaptureRequest` (`@lervo/repository-knowledge`) through the no-capability JSON runner, using `instructionCaptureAssessmentInstruction` as the system prompt, a 120-second bound, and the bounded canonical-instruction catalog. The provider response contains `{schemaVersion, captureClass, durableInstruction, decision, reasonIds, practice}`. The rule fields retain their exact `parseInstructionCaptureAssessment` contract; `practice` is a nullable, independently assessed procedure under the [practice learning contract](../practice-learning.md). Invalid practice leaves the rule result intact. The instruction forbids keyword, phrase, substring, regular-expression, alias, and synonym-list classification.

Practice extraction uses a separate completed-work record under `.lervo/state/knowledge/practice/`; it does not enlarge the legacy capture queue or its 2 KiB preceding-reply bound. The legacy queue has no session field. The resident attaches preceding work only when the prompt digest, provider and capture time identify one prepared context. Ambiguous matches remain eligible for the 30-minute local practice assessment. Added capture work is charged to the separate skill-learning budget, and practice extraction failure does not fail rule capture. The practice learning contract owns work-record bounds, evidence retention, review and implementation status.

| Class | Outcome |
| --- | --- |
| `durable_instruction` | Durable-instruction plan: candidate, `covered`, held `rule_needs_clarification`, or ignored |
| `correction_of_agent_behavior` | Same as `durable_instruction` |
| `decision` | Held `decision`; a decision that is itself a canonical rule follows the instruction path |
| `preference_personal` | Counted; nothing stored |
| `none` | Counted; nothing stored |

A candidate carries `captureSource`, `captureId`, and the instruction-catalog digest used for assessment. An existing candidate for the same words counts as `covered`.

Budgets are 4 assessments per cycle, 12 per hour, 60 per day, and 200,000 tokens per day. Spend requires reviewed convergence delegation, host admission, and an unpaused provider. Otherwise, the cycle reports `deferred` with `knowledge_authority_unavailable`, `knowledge_capacity_unavailable`, or `knowledge_provider_paused`, and turns remain queued.

A failed call or invalid assessment counts as one attempt; the third failure drops the turn. Each call records ADR-0459 usage with `channel: knowledge_worker` and `stage: instruction_capture`.

## Events

Events contain identifiers, digests, classes, and counts. Turn text, provider output, rule text, and decision summaries never enter an event.

- `knowledge.instruction_candidate.captured`: `candidateId`, `captureId`, `source`, `captureClass`, `turnDigest`, `occurredAt`.
- `conversation.knowledge_candidate.recorded`: `conversationEventId`, `agentId`, `kind`, `subjectKeyDigest`, `summaryHash`, `candidateId`, `occurredAt`; recorded only for conversation captures.
- `knowledge.instruction_candidate.exchanged`: `candidateId`, `proposedContentHash`, `ruleId`, `direction` (`published | imported | resolved`), `resolution`, `sourceHostHash`, `occurredAt`.
- `knowledge.instruction_capture.cycle.completed`: `cycleId`, counts `assessedCount`, `instructionCandidateCount`, `decisionCount`, `ignoredCount`, `personalPreferenceCount`, `coveredCount`, `failedCount`, `expiredCount`, `skippedForBudget`, `usageObserved`, and `occurredAt`.
