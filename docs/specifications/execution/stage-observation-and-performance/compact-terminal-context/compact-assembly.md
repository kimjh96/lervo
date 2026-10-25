# Compact assembly

The shared Codex and Claude hook command uses compact preparation by default, without a provider call. `LERVO_TERMINAL_CONTEXT=retrieval` selects the existing per-prompt retrieval path, including provider query projection.

Normal compact preparation captures the repository snapshot before concurrently starting knowledge-snapshot lookup, deterministic empty projection/workstream loading, canonicalization-candidate listing, and resident-health inspection. Candidate-list failure becomes unavailable coverage. Other preparation failures return the independent base context under [ADR-0531](../../../../decisions/execution/providers/hooks/0531-bound-terminal-hooks-and-retain-degraded-context.md).

Only after prompt preparation fails does the hook start independent base reads: publication policy, complete applied instructions, and the verified recorded workstream. These reads share a deadline at most 2,500 ms later, capped by the remaining 15,000 ms hook budget. Healthy prompts perform no additional base reads. Failure retains the AGENTS.md pointer, a closed degraded reason, and each successful base result. The workstream section contains its bounded title and revision and says freshness was not inspected. It omits next actions, blockers, decisions, and approvals. It also omits knowledge health, freshness counts, selected documents, and unsupported preparation evidence. An observed worker attachment retains its scope guidance. Failed base reads contribute no invented replacement value.

The deterministic projector reports `empty`, zero queries, and zero projection duration. Returned context has zero recommendations and documents, abstaining grounding, ignored durable-instruction materialization, and selection disposition `query_projection_missing`. It provides no retrieved-document delivery or use evidence.

Workstream text includes:

- A title bounded to 200 bytes.
- The first next action bounded to 360 bytes.
- At most three pending decision questions bounded to 240 bytes each.
- The total pending-decision count, decision identifiers, blocking markers, and recommended choice identifiers.

Workstream evidence hashes the complete snapshot while declaring delivered scope `prefix` and the actual delivered byte count.

The preamble includes at most five blocking attention items, an on-demand knowledge-query instruction, and workstream start/update instructions. It uses background-owned wording when the resident is healthy or the workspace binding identifies a worker; otherwise it includes the supplied declaration instruction. Assembly caps the complete context at 4,096 UTF-8 bytes, preserving the preamble before allocating the remaining bytes to continuation. Truncation updates the delivered byte count and never splits a Unicode character. [ADR-0451](../../../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)'s installed size and latency targets require separate verification.

Both compact and retrieval modes render the current `publication.language` and its resolved writing-policy identifier independently of document ranking. Under the supported `en` policy, new or revised repository documentation uses English even for a Korean request, unless the user explicitly requests an exception. The instruction leaves conversational response language separate and grants no authority to translate unrelated user-owned content. It appears before optional attention and continuation content so compact truncation retains it. Retrieval projection failure does not remove the instruction; policy-loading failure omits that line from the degraded response while preserving other successful base reads.

The policy line is hook-prepared configuration context, not a retrieved document. It adds no recommendation, selection, loading, injection, reference, or use claim. Existing context hashes bind the prepared bytes. No event, persistent state, provider call, ranking change, or publication permit is added. Regression tests cover Codex and Claude with Korean requests and empty or failed retrieval, plus crowded compact context. These tests prove instruction preparation, not provider compliance or installed hook activation.

The preamble also carries [ADR-0467](../../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)'s owner-turn capture lines: pending instruction candidates and held items, and titles of applied rules under `docs/instructions/generated/`. Both are read from local files without a provider call. Separately, the hook queues the owner's prompt for background capture under `event_commit`; assignment-workspace sessions are excluded.
