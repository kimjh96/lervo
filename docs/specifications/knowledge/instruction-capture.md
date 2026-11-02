# Owner-turn instruction capture

Status: `wired`
As of: 2026-11-02

This contract implements [ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) and the instruction-capture and conversation-decision part of [ADR-0457](../../decisions/knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md), as amended by [ADR-0545](../../decisions/knowledge/documents/capture/0545-apply-owner-stated-rules-without-a-review-command.md) and [ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md). It defines owner-turn intake, resident assessment, cross-check, storage, application, and delivery to every provider.

## Pipeline

Terminal `UserPromptSubmit` and managed conversation turns enter a transient queue without a provider call. Resident assessment produces a rule, a held decision, or nothing for none, personal preference, and covered outcomes. Under [ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), a rule is stored only after an independent cross-check agrees with it. After capture and Hub candidate exchange, the convergence owner applies every stored candidate to `docs/instructions/generated/`. A single host without Hub coordination applies locally. Nothing in this pipeline waits for the owner.

## Cross-check before storage

The assessment call writes a normalized rule. When its statement and exceptions are not the owner's own words, a second governed no-capability call checks it in a fresh session (`durable_instruction_cross_check`, usage stage `instruction_cross_check`). The check sees the owner turn, the preceding agent turn, and the proposed rule, never repository files. For a rule the owner stated (`authority: explicit_user`), it checks fidelity. For an inferred rule, it also checks that the turn establishes the rule for future work.

- `agree`: the candidate is stored and applied in the next owner cycle.
- `disagree`: nothing is stored. A held `cross_check_disagreement` entry records the rejection as Lervo debt.
- The call cannot run (`deferred`): the turn stays queued for a later cycle.
- The call fails or answers invalidly: the attempt counts like a failed assessment.

## Automatic application

Each owner resident cycle applies every stored candidate, whatever its authority, risk, operation, conflict, or confidence. Apply rebuilds the plan against current bytes; there is no catalog binding. A rule that replaces an older generated rule in the same scope deletes it in the same transaction and commit. Application writes the generated rule and records `knowledge.materialization.applied` with `operation: durable_instruction_intake`, binding an apply digest for the settling identity `lervo`. On a Hub-coordinated owner, settlement requires the rule's `Lervo Knowledge` commit (`docs: apply an owner rule`) before publishing the `applied` resolution and removing the candidate. A failed commit keeps the candidate for the next cycle. Automatic-apply failure does not fail the resident cycle.

Non-owner hosts assess local turns and exchange candidates, but never apply them. `lervo knowledge instruction review` is removed. `lervo knowledge instruction retire <rule-id>` is the undo, and the ADR-0549 learned notice reports each stored rule after the fact.

## Held items are Lervo debt

`decision` entries (owner decisions Lervo has not documented yet) and `cross_check_disagreement` entries project as `captured_decision` attention with state `lervo_debt`, `heldKind`, and `requiresUserAction: false`. `rule_needs_clarification` is no longer written; older state that holds it projects as `cross_check_disagreement`. `lervo knowledge instruction capture --dismiss <capture-id>` clears an item.

## Contract

- [Intake, assessment, storage, and events](instruction-capture/runtime.md)
- [Host parity and candidate exchange](instruction-capture/host-convergence.md)
- [Visibility and evaluation](instruction-capture/review-and-evaluation.md)
