# Lapsed deadline backoff

`ConversationChangeLoop` accepts `idleBackoff: { baseMs, ceilingMs, unchanged(result) }`. When the wake-up deadline has already passed and `unchanged(result)` holds, the delay doubles from `baseMs` to `ceilingMs`. A change notification, changed result, future deadline, or no deadline resets it to `baseMs`. The streak exists only in process memory; a process restart loses it and restarts at `baseMs`.

The supervision loop uses `{ baseMs: 5_000, ceilingMs: 300_000 }`. A cycle counts as unchanged when it is:

- An unchanged skip. The skip compares the source digest and, when one exists, the event ID of the latest unresolved preflight block (`supervisionCursorDigest`).
- An `idle` or `blocked` evaluation with the same source digest and blocked state as the previous evaluation.

`busy`, `changed`, `effect_confirmed`, and `uncertain` cycles retain the five-second retry. A lapsed progress deadline therefore re-evaluates within 300 seconds. Local and peer event hints wake the owner immediately.

## Evaluation backoff and authority audits

The 300-second ceiling governs unchanged evaluation retries. It does not permit delaying the authority tail audit to that ceiling. [ADR-0508](../../../../../../../decisions/operations/services/0508-observe-standing-supervision-only-when-its-source-can-differ.md) requires a skipped wake-up to run `NodeSupervisionStore.auditHistory` and detect a missed hint within 60 seconds. Scheduling must preserve that audit deadline during evaluation backoff. The [observation gate](observation-gate.md) determines whether a wake-up requires a full observation or can perform only the audit.

Every cycle re-reads authority, revocation, and mandate expiry before an effect can run. These effect checks remain required, but they do not substitute for timely detection of appended authority events. This contract replaces the earlier statement that the 60-second audit waits for the next backed-off cycle.

## Verification boundary

The source reports tests for the backoff sequence and its resets. No supplied implementation or test evidence establishes the combined backoff and audit timing contract. Verification must exercise a lapsed progress deadline at maximum backoff, append an authority event without delivering a hint, and demonstrate detection within 60 seconds while preserving the evaluation retry ceiling and effect checks. This correction records the required behavior without claiming a passing test, deployment, or installed acceptance.
