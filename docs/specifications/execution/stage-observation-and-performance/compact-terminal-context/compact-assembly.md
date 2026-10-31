# Compact assembly

Compact preparation captures the repository snapshot before concurrently starting knowledge-snapshot lookup, deterministic empty projection/workstream loading, canonicalization-candidate listing, resident-health inspection, and a bounded read of the precomputed repository health file plus a live resident heartbeat. Health-file failure becomes unknown without computing a replacement. Candidate-list failure becomes unavailable coverage; other failures can propagate to the hook's availability-safe handling.

The deterministic projector reports `empty`, zero queries, and zero projection duration. Returned context has zero recommendations and documents, abstaining grounding, ignored durable-instruction materialization, and selection disposition `query_projection_missing`. It provides no retrieved-document delivery or use evidence.

Workstream text includes:

- A title bounded to 200 bytes.
- The first next action bounded to 360 bytes.
- At most three pending decision questions bounded to 240 bytes each, attributed to the principal proxy for consequence classification.
- The total pending-decision count, decision identifiers, blocking markers, and recommended choice identifiers.

Workstream evidence hashes the complete snapshot while declaring delivered scope `prefix` and the actual delivered byte count.

The preamble includes at most five blocking agent attention items, an on-demand knowledge-query instruction, and workstream start/update instructions. It uses background-owned wording when the resident is healthy or the workspace binding identifies a worker; otherwise it includes the supplied declaration instruction. Assembly caps the complete context at 4,096 UTF-8 bytes, preserving the preamble before allocating the remaining bytes to continuation. Truncation updates the delivered byte count and never splits a Unicode character. [ADR-0451](../../../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)'s installed size and latency targets require separate verification.

Both compact and retrieval modes render the current `publication.language` and its resolved writing-policy identifier independently of document ranking. Under the supported `en` policy, new or revised repository documentation uses English even for a Korean request, unless the user explicitly requests an exception. The instruction leaves conversational response language separate and grants no authority to translate unrelated user-owned content. It appears before optional attention and continuation content so compact truncation retains it. Retrieval projection failure does not remove the instruction; policy-loading failure still follows availability-safe hook handling.

The policy line is hook-prepared configuration context, not a retrieved document. It adds no recommendation, selection, loading, injection, reference, or use claim. Existing context hashes bind the prepared bytes. No event, persistent state, provider call, ranking change, or publication permit is added. Regression tests cover Codex and Claude with Korean requests and empty or failed retrieval, plus crowded compact context. These tests prove instruction preparation, not provider compliance or installed hook activation.

Under [ADR-0535](../../../../decisions/execution/applications/0535-project-core-health-with-actor-owned-attention.md), one cached [Know/Find health section](../../operating-attention/repository-health.md) replaces freshness-review and pending instruction-capture chores. It is empty when every measure is within target, otherwise at most 520 UTF-8 bytes with age, actor/recovery, unknown reasons and omission counts. Owner authority belongs to one batch in that section, merging currently read
workstream approvals with cached owner entries and deduplicating their identities.
Missing cache coverage does not suppress an observed approval. The health reader performs no event scan, provider call, lint or recomputation.
The older workstream verification path still scans events and can restore missing
state; whole-prompt bounded provenance is a separate follow-up. Exact applied owner rules continue through the existing instruction preamble. Separately, the hook queues the owner's prompt for background capture under `event_commit`; assignment-workspace sessions are excluded.

## Exact prompt anchors

Under [ADR-0538](../../../../decisions/execution/grounding/0538-find-governing-context-through-exact-prompt-anchors.md), the compact prompt extracts exact anchors from the prompt against the current repository snapshot. It makes no provider call and adds no event.

A path anchor is written as a path: a token with a slash that equals a snapshot path or directory, or a file name with an extension that equals a root file or names exactly one snapshot file. Bare words never anchor, even when a directory has that name. The most exact spelling wins; a `:line` suffix, enclosing brackets, and an attached Korean particle of at most three syllables are removed only when the exact spelling names nothing. Brackets and parentheses inside a path, as in `app/[lang]/page.tsx`, stay part of it.

Up to three pointer lines carry a path and content hash:

- a skill named by `/name` or `$name`;
- a decision named by `ADR-####`;
- the nearest nested `AGENTS.md` governing a path anchor.

A prompt is partial evidence of scope, so path anchors never narrow owner-rule selection. Owner rules are packed first; a pointer line is added whole only while the 4 KiB budget allows. Pointers that reach the context are recorded as `selected` in the preparation observation with `loading: unobserved`, because their bodies are never loaded by the hook. Pointers never include file bodies.

[ADR-0541](../../../../decisions/execution/grounding/0541-bind-agent-queries-to-the-turn-and-observe-path-references.md) retains the delivered pointer paths, hashes, and kinds as `selectedPointers` on `terminal.context.prepared`. Preparation writes a host-private open-turn marker after committing that event. Agent-run queries bind to a single open turn; Stop observes selected path mentions through the [terminal evidence contract](../../events-and-privacy/terminal-observations/context-reference-and-turn-evidence.md). These effects add no provider call, retrieved body, or prompt bytes.
