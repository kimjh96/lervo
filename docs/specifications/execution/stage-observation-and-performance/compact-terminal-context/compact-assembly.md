# Compact assembly

Compact preparation captures the repository snapshot before concurrently starting knowledge-snapshot lookup, deterministic empty projection/workstream loading, canonicalization-candidate listing, and resident-health inspection. Candidate-list failure becomes unavailable coverage; other failures can propagate to the hook's availability-safe handling.

The deterministic projector reports `empty`, zero queries, and zero projection duration. Returned context has zero recommendations and documents, abstaining grounding, ignored durable-instruction materialization, and selection disposition `query_projection_missing`. It provides no retrieved-document delivery or use evidence.

Workstream text includes:

- A title bounded to 200 bytes.
- The first next action bounded to 360 bytes.
- At most three pending decision questions bounded to 240 bytes each.
- The total pending-decision count, decision identifiers, blocking markers, and recommended choice identifiers.

Workstream evidence hashes the complete snapshot while declaring delivered scope `prefix` and the actual delivered byte count.

The preamble includes at most five blocking attention items, an on-demand knowledge-query instruction, and workstream start/update instructions. It uses background-owned wording when the resident is healthy or the workspace binding identifies a worker; otherwise it includes the supplied declaration instruction. The module applies item bounds but has no final aggregate context-size check. [ADR-0451](../../../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)'s size targets require separate verification.

The preamble also carries [ADR-0467](../../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)'s owner-turn capture lines: pending instruction candidates and held items, and titles of applied rules under `docs/instructions/generated/`. Both are read from local files without a provider call. Separately, the hook queues the owner's prompt for background capture under `event_commit`; assignment-workspace sessions are excluded.
