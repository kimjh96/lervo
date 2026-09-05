# Durable-instruction intake

`knowledge instruction intake` transiently sends only the supplied request and bounded catalog to the selected no-capability provider grounding adapter. It stores a local candidate containing the normalized typed instruction, exact proposed Markdown and hash, source snapshot, plan coordinates, request digest, and resolver digest. It stores neither the raw request nor provider output and does not change canonical instruction bytes.

Candidate state requires exact review; it proves neither approval, correctness, provider delivery, provider use, nor canonical status. The ignored active registry is sharded, bounded to 64 records and 16 KiB per record, and removes records after apply or reject.

`knowledge instruction review` requires one candidate ID, the exact current candidate hash, a bounded reviewer identity, and `apply` or `reject`. Apply rechecks the project, unchanged complete instruction catalog, deterministic target, proposed bytes, and plan. It writes only the new Lervo-generated file under `docs/instructions/generated/` and never overwrites user-owned bytes. Reject changes no repository instruction.

Successful apply emits the existing `knowledge.materialization.applied` event with `operation=durable_instruction_intake`. Required payload fields are plan ID, source snapshot, policy and compiler coordinates, hash-only approval digest, complete coverage, bounded creation counts, before-and-after catalog digests, and application time. The event excludes requests, rule text, Markdown bodies, reviewer IDs, absolute paths, provider output, configuration, and credentials.

Wrong or stale review hashes, catalog changes, target conflicts, invalid reviewers, incomplete catalogs, unsafe candidate state, and transaction failures create no success event or canonical rule. If the event committed but local candidate cleanup did not, replay validates the exact target and approval digest, then removes the candidate without rewriting the rule.

The direct `UserPromptSubmit` hook remains retrieval-only and reports `unmanaged_terminal_retrieval_only`. It may instruct the agent to invoke this explicit lifecycle, but cannot perform semantic effect grounding, create or approve a candidate, or write a rule.
