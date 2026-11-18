# Durable-instruction intake

Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), an owner rule is always stored and applied. Nothing waits for an owner review, approval, or hash.

## Intake

`knowledge instruction intake` transiently sends only the supplied request and the bounded instruction catalog to the selected no-capability provider grounding adapter, with a 120-second bound. The grounded rule's risk, operation, conflict, confidence, authority, and scope are classification, not admission:

- Broad, removal, policy, and authority-changing rules are stored with that classification in the rule's frontmatter (`authority`, `operation`, `risk`, `classification`).
- Unspecified scope means repository-wide.
- A rule that names older catalog entries in `replaces` deletes each one that is a Lervo-generated rule under `docs/instructions/generated/` with the same scope. User-owned instruction files are never deleted; a skipped replacement is reported as `replacement_not_generated_rule`, `replacement_absent`, or `replacement_scope_differs`. The new rule's frontmatter lists the rule IDs it replaced.
- `none` and `workstream` dispositions are not repository-long rules and store nothing.

## Fidelity check

The only check for an explicit owner rule is that the stored text matches what the owner said:

- When the statement and every exception appear verbatim in the request, ignoring whitespace, the stored text is the owner's own wording and needs no model check (`fidelity: owner_wording`).
- Otherwise the stored text is a restatement, for example a translation. A fresh no-capability provider session, independent of the grounding call, compares it with the request (`durable_instruction_cross_check`). Only `agree` stores it (`fidelity: cross_checked`).

## Background retry

When grounding fails, the rule text is missing, or the fidelity check disagrees or cannot run, the request is written to the private owner-turn capture queue as a **retained** record. A retained record never expires and is never evicted. The knowledge resident assesses it with the [owner-turn capture](../../../knowledge/instruction-capture.md) path, including that path's independent cross-check. After a failed attempt, it waits an exponentially growing delay of at most one day. Intake then returns `queued`. If 32 retained records already wait, intake returns `not_stored` with `retained_queue_full` and exit status 1.

Grounding failure reasons remain `semantic_resolution_failed` plus one stage reason: `semantic_resolution_provider_timed_out`, `semantic_resolution_provider_unavailable`, `semantic_resolution_provider_process_failed`, `semantic_resolution_proposal_invalid`, or `semantic_resolution_resolver_failed`. No reason carries provider output.

## Storage and application

A checked rule is stored as a local candidate containing the normalized typed instruction, exact proposed Markdown and hash, source snapshot and instruction-catalog digest, plan coordinates, and request and resolver digests. The candidate never contains the raw request.

On a single host or the convergence owner, intake applies the candidate immediately; otherwise the candidate waits for the Hub exchange and the owner's resident. Each resident cycle on the owner applies every stored candidate. Apply rebuilds the plan against current bytes. If the same rule is already present, the candidate settles as `current`. Apply writes the generated rule, deletes the generated rules it replaces in the same transaction, and records `knowledge.materialization.applied` with `operation=durable_instruction_intake`. The payload carries plan and source coordinates, policy and compiler coordinates, a hash-only apply digest bound to the settling identity `lervo`, complete coverage, the created, updated, unchanged, and deleted counts, before and after catalog digests, and the application time. It excludes requests, rule text, Markdown bodies, absolute paths, provider output, configuration, and credentials.

On a Hub-coordinated owner, the rule file and each replaced rule's deletion are committed together as `Lervo Knowledge` with the subject `docs: apply an owner rule`. The candidate settles only after that commit exists. If the commit fails, the written rule and its apply event stay, and the next cycle retries the commit.

Intake results are `applied`, `current`, `stored`, `queued`, `ignored`, `workstream`, or `not_stored`; no path returns `pending`, and no reason is `automatic_gate_not_satisfied`.

## Notice and undo

The [ADR-0549 learned notice](../../../../decisions/execution/applications/0549-tell-the-owner-what-lervo-learned-after-development.md) reports each stored rule after the fact, as `stored owner rule "<title>" (<path>) (replaced <rule-id>)`, with the undo command. The notice is information, not a task.

`lervo knowledge instruction retire <rule-id>` deletes one generated rule. On a Hub-coordinated owner, it commits the deletion with the subject `docs: retire an owner rule`. Reverting the owner-rule commit restores a replaced rule. `lervo knowledge instruction review`, its `--reviewer`, and its `--approval` are removed.

## Owner-turn capture

The direct `UserPromptSubmit` hook performs no semantic grounding and reports `unmanaged_terminal_retrieval_only`. It only queues the owner's turn for [owner-turn instruction capture](../../../knowledge/instruction-capture.md). The knowledge resident assesses it off the critical path and stores a candidate of this same kind, with `captureSource` and `captureId`, only after an independent cross-check agrees.
