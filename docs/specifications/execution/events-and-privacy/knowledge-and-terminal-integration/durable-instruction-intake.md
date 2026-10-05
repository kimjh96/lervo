# Durable-instruction intake

## Intake and candidate state

`knowledge instruction intake` transiently sends only the supplied request and bounded catalog to the selected no-capability provider grounding adapter, with a 120-second bound. It stores a local candidate containing:

- the normalized typed instruction;
- exact proposed Markdown and hash;
- source snapshot and instruction-catalog digest;
- plan coordinates; and
- request and resolver digests.

It stores neither the raw request nor provider output and does not change canonical instruction bytes.

Grounding failure returns `ignored` with `semantic_resolution_failed` and one stage reason:

- `semantic_resolution_provider_timed_out`;
- `semantic_resolution_provider_unavailable` for quota, authentication, capacity, or another provider-reported failure;
- `semantic_resolution_provider_process_failed`;
- `semantic_resolution_proposal_invalid`; or
- `semantic_resolution_resolver_failed`.

No reason carries provider output.

Candidates require exact review and prove neither approval, correctness, provider delivery, provider use, nor canonical status. The ignored active registry is sharded, bounded to 64 records and 16 KiB per record, and removes records after apply or reject.

## Review and application

`knowledge instruction review` requires one candidate ID, the exact current candidate hash, a bounded reviewer identity, and `apply` or `reject`.

Apply rechecks the project, complete instruction catalog (unchanged source snapshot, or unchanged instruction entries when the candidate records their digest), deterministic target, proposed bytes, and plan. It writes only the new Lervo-generated file under `docs/instructions/generated/` and never overwrites user-owned bytes. Reject changes no repository instruction.

Successful apply emits the existing `knowledge.materialization.applied` event with `operation=durable_instruction_intake`. Required payload fields are:

- plan ID and source snapshot;
- policy and compiler coordinates;
- hash-only approval digest;
- complete coverage and bounded creation counts;
- before-and-after catalog digests; and
- application time.

The event excludes requests, rule text, Markdown bodies, reviewer IDs, absolute paths, provider output, configuration, and credentials.

Wrong or stale review hashes, catalog changes, target conflicts, invalid reviewers, incomplete catalogs, unsafe candidate state, and transaction failures create no success event or canonical rule. If the event committed but local candidate cleanup did not, replay validates the exact target and approval digest, then removes the candidate without rewriting the rule.

## Owner-turn capture

The direct `UserPromptSubmit` hook performs no semantic grounding and reports `unmanaged_terminal_retrieval_only`. It only queues the owner's turn for [owner-turn instruction capture](../../../knowledge/instruction-capture.md). The knowledge resident assesses it off the critical path and may create a candidate of this same kind with `captureSource` and `captureId`. No hook or capture path approves a candidate or writes a rule.
