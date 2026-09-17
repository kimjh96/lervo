# Growth and module boundaries

Keep these responsibilities independently testable:

1. Native event decoding and authentication.
2. Participant and conversation-coordinate resolution.
3. Semantic intent and participation decisions.
4. Application command/query execution.
5. Activity projection and redaction.
6. Search planning and corpus adapters.
7. Rendering and platform delivery.
8. Durable delivery reservation, replay, and recovery.

An entrypoint may own only parsing, composition, result translation, and exit or delivery status. Split a module when it mixes policy with I/O, integrates multiple external systems, combines mutation with rendering, or requires independent fixture families. Production modules at 400 lines retain the repository-wide exact-content structural review; semantic split signals apply before that threshold.

Growing projections require bounded pagination, cursors, retention, and compaction. Long-running hosts subscribe from an exact event or source revision and reuse prepared projections only while that revision remains current. Full-state polling, one unbounded transcript, and one file per event are prohibited storage designs.
