# ADR-0073: Doctor recovery guidance without automatic repair

- Status: `accepted`
- Decision date: 2026-08-20

## Context

Issue codes alone provide little guidance about the next check. Deriving remedies dynamically from paths or errors could leak source data or invent unavailable commands, while performing repairs would violate doctor's read-only role.

## Decision

- Every report includes `recoveryGuidance` entries containing `issueCode`, a controlled `actionCode`, a fixed English `message`, and `actionState: not_performed`.
- Derive guidance only from registered issue codes, never from error prose. A compile-time exhaustive mapping requires guidance for every new issue.
- Deduplicate repeated issue codes by first occurrence. Preserve distinct issue codes even when they map to the same action. No issues means no guidance.
- Text reports render a “Next checks” section and state that no repair or state change occurred. JSON uses the identical structure.
- The generator reads or copies neither issue messages nor event IDs. Guidance contains no project or source IDs, digests, paths, bodies, outputs, credentials, or errors.
- Execute no command and create or change no file, event, Hub state, approval, selection, review, or action state.

## Consequences

Users receive safe next checks without any claim of diagnostic certainty, authorization, repair, or recovery success.
