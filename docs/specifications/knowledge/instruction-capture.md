# Owner-turn instruction capture

Status: `wired`
As of: 2026-11-01

This contract implements [ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) and the instruction-capture and conversation-decision part of [ADR-0457](../../decisions/knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md), as amended by [ADR-0545](../../decisions/knowledge/documents/capture/0545-apply-owner-stated-rules-without-a-review-command.md). It defines owner-turn intake, resident assessment, storage, review, and delivery to every provider.

## Pipeline

Terminal `UserPromptSubmit` and managed conversation turns enter a transient queue without a provider call. Resident assessment produces an exact-hash candidate, a held decision or rule, or nothing for none, personal preference, and covered outcomes. After capture and Hub candidate exchange, the convergence owner automatically applies eligible owner-stated candidates to `docs/instructions/generated/`. A single host without Hub coordination applies locally. Held items retain their existing resolution path.

## Automatic application

Each owner resident cycle attempts every stored candidate with `authority: explicit_user`. The existing plan gate must still admit an explicit, repository-wide directive adding a rule with specified scope, low risk, no conflict, high confidence, and a complete instruction catalog. Rebuilding against the current catalog must produce a `ready` plan with the same plan, rule, target, and bytes. The recorded reviewer is `lervo-principal-proxy`; no owner or agent review command is required.

Candidates remain bound to their assessed catalog. Each automatic apply records the catalog digest before and after. A chain of those recorded owner-rule applies may connect a candidate's digest to the current catalog without staling it; any other catalog change still stales it.

Application writes the generated rule and records `knowledge.materialization.applied` with `operation: durable_instruction_intake`, binding the principal-proxy approval digest. On a Hub-coordinated owner, settlement requires the rule's `Lervo Knowledge` commit before publishing the `applied` resolution and removing the candidate. If committing fails, the written rule and apply event remain, and the next cycle retries the commit before settlement. A failed gate leaves the candidate stored for retry. Automatic-apply failure does not fail the resident cycle and is not recorded as a failure.

Non-owner hosts assess local turns and exchange candidates, but never apply them. Refusal wording must say that the owner receives the candidate through Hub exchange and applies it automatically; it must not claim the owner already holds it. Generated instruction routes describe automatic application, and capture attention names the principal proxy rather than assigning routine review to the owner.

`lervo knowledge instruction review` remains available for rejection or manual application. Undo is an ordinary change to the generated file or a new owner statement. Candidate, exchange, and privacy contracts remain unchanged; no event type or candidate field is added.

Installed verification remains required: the owner's 2026-11-01 rule must apply on the WSL owner without a review command and subsequently reach the Mac through publication. The accepted decision alone does not prove that journey completed.

## Contract

- [Intake, assessment, storage, and events](instruction-capture/runtime.md)
- [Host parity and candidate exchange](instruction-capture/host-convergence.md)
- [Review, visibility, and evaluation](instruction-capture/review-and-evaluation.md)
