# ADR-0073: Doctor recovery guidance without automatic repair

Status: `accepted`
Decision date: 2026-08-20

## Context

Issue codes alone provide little next-step guidance. Dynamically deriving remedies from paths/errors could leak source or invent unavailable commands, while repair would violate doctor's read-only role.

## Decision

- Every report includes `recoveryGuidance` entries with `issueCode`, controlled `actionCode`, fixed English `message`, and `actionState: not_performed`.
- Derive only from registered issue codes, never error prose. Compile-time exhaustive mapping requires guidance for each new issue.
- Deduplicate repeated issue codes by first occurrence; keep distinct codes even when actions match. No issues means no guidance.
- Text renders a “Next checks” section and states no repair/state change occurred; JSON uses identical structure.
- Generator reads/copies neither issue message nor event ID and includes no project/source IDs, digests, paths, bodies, outputs, credentials, or errors.
- Execute no command and create/change no file/event/Hub/approval/selection/review/action state.

## Consequences

Users receive safe next checks, never a claim of diagnosis certainty, authorization, repair, or recovery success.
