# Owner-turn instruction capture

Status: `wired`
As of: 2026-10-05

This contract implements [ADR-0466](../../decisions/knowledge/documents/0466-capture-owner-turns-semantically-in-the-knowledge-resident.md), the instruction-capture and conversation-decision part of [ADR-0457](../../decisions/knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md). It names where owner turns enter, what the resident does with them, what is stored, and how a captured rule reaches review and every provider.

## Pipeline

```
terminal UserPromptSubmit ─┐                                  ┌─► exact-review candidate ─► owner review ─► docs/instructions/generated/
                           ├─► transient queue ─► resident ───┼─► held decision or rule (owner confirms or dismisses)
managed conversation turn ─┘   (no provider)     assessment   └─► nothing (none, personal preference, covered)
```

## Entry points

| Surface              | Module                                                     | Owner turn                    | Preceding agent turn                           |
| -------------------- | ---------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| Claude Code, Codex   | `apps/cli/src/terminal-instruction-capture.ts`             | `UserPromptSubmit` prompt     | the session's last `Stop` reply, at most 2 KiB |
| Managed conversation | `apps/node-runtime/src/conversation-owner-turn-capture.ts` | a human participant's message | the last agent reply in the thread             |

Sessions bound to an assignment workspace and agent messages are not captured. The hook measures the enqueue under `event_commit`; it calls no provider and classifies nothing. `Stop` starts a detached `knowledge-worker` cycle when turns are queued. The resident also wakes because the queue listing is part of the ADR-0461 fingerprint.

## Queue and state

| Path under `.lervo/state/knowledge/instruction-capture/` | Content                                                                         | Bound                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| `queue/kcap_<24 hex>.json`                               | owner turn, preceding agent turn, `promptDigest`, source, conversation event ID | 32 records, 24 hours, deleted when assessed    |
| `agent-turns/<24 hex>.json`                              | last agent reply of one terminal session                                        | 16 sessions, 2 KiB each, 6 hours               |
| `state.json`                                             | budget windows, assessed tombstones, held decisions and rules (normalized text) | 256 tombstones for 7 days, 16 held for 30 days |

Files are 0600 in 0700 directories and Git-ignored. The capture ID binds the source, the owner-turn digest, the preceding-turn digest, and the conversation event ID, so several agents queueing the same message produce one record. When the queue is full, the oldest record is evicted.

## Assessment

`runInstructionCaptureCycle` (`packages/repository-knowledge-runtime/src/instruction-capture-stage.ts`) runs first in `runAutonomousKnowledgeWorker`. A failure leaves the queue for the next cycle and blocks no other stage.

Per turn it sends `instructionCaptureRequest` (`@lervo/repository-knowledge`) through the no-capability JSON runner with `instructionCaptureAssessmentInstruction` as the system prompt, a 120-second bound, and the bounded canonical-instruction catalog. The provider returns `{schemaVersion, captureClass, durableInstruction, decision, reasonIds}`; `parseInstructionCaptureAssessment` validates it exactly. The instruction forbids keyword, phrase, substring, regular-expression, alias, and synonym-list classification.

| Class                          | Outcome                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `durable_instruction`          | durable-instruction plan: candidate, `covered`, held `rule_needs_clarification`, or ignored      |
| `correction_of_agent_behavior` | same as `durable_instruction`                                                                    |
| `decision`                     | held `decision`; a decision that is itself a canonical rule follows the instruction path instead |
| `preference_personal`          | counted, nothing stored                                                                          |
| `none`                         | counted, nothing stored                                                                          |

A candidate carries `captureSource`, `captureId`, and the instruction-catalog digest it was judged against. An existing candidate for the same words counts as `covered`.

Budget: 4 assessments per cycle, 12 per hour, 60 per day, 200,000 tokens per day. Spend needs the reviewed convergence delegation, host admission, and an unpaused provider; otherwise the cycle reports `deferred` with `knowledge_authority_unavailable`, `knowledge_capacity_unavailable`, or `knowledge_provider_paused`, and the turns stay queued. A failed call or invalid assessment counts one attempt; the third failure drops the turn. Each call records ADR-0459 usage with `channel: knowledge_worker` and `stage: instruction_capture`.

## Events

Events carry identifiers, digests, classes, and counts. Turn text, provider output, rule text, and decision summaries never enter an event.

- `knowledge.instruction_candidate.captured`: `candidateId`, `captureId`, `source`, `captureClass`, `turnDigest`, `occurredAt`.
- `conversation.knowledge_candidate.recorded`: `conversationEventId`, `agentId`, `kind`, `subjectKeyDigest`, `summaryHash`, `candidateId`, `occurredAt`; recorded for conversation captures only.
- `knowledge.instruction_capture.cycle.completed`: `cycleId` and the counts `assessedCount`, `instructionCandidateCount`, `decisionCount`, `ignoredCount`, `personalPreferenceCount`, `coveredCount`, `failedCount`, `expiredCount`, `skippedForBudget`, `usageObserved`, plus `occurredAt`.

## Review and visibility

- The compact prompt shows `Instruction capture: …` while candidates or held items exist, and `Applied owner rules (follow them; …): <titles>` while generated rules exist. Each line is at most 600 bytes and lists normalized titles only.
- `lervo application attention` lists `durable_instruction_candidate` and `captured_decision` items.
- `lervo knowledge instruction status` shows each candidate's source; `lervo knowledge instruction review <id> --decision apply|reject --reviewer <id> --approval <hash>` applies or rejects it.
- `lervo knowledge instruction capture [--json]` shows queue depth (digests only), budget, and held items; `--dismiss <capture-id>` removes a held item.
- Apply writes only `docs/instructions/generated/<rule-id>.md`. Managed runs and Discord turns receive those files under `repository.instructions`; terminal agents see their titles in every compact prompt.

Captured rules are never applied without exact review; ADR-0466 records why and what an automatic-apply amendment would need.

## Evaluation

`benchmarks/grounding/instruction-capture-v1.json` holds 28 English and Korean cases: explicit and paraphrased rules, implicit corrections with the agent turn they correct, decisions, personal preferences, and negatives. `node scripts/evaluation/run-instruction-capture-evaluation.mjs --provider <claude|codex>` records one real-provider observation per case. `pnpm evaluation:natural-language:check` requires class agreement of at least 0.8, rule and correction recall of at least 0.85, and no non-rule turn proposed as a canonical rule.
