# Lapsed deadline backoff

`ConversationChangeLoop` accepts `idleBackoff: { baseMs, ceilingMs, unchanged(result) }`. When the wake-up deadline has already passed and `unchanged(result)` holds, the delay doubles from `baseMs` to `ceilingMs`. A change notification, changed result, future deadline, or no deadline resets it to `baseMs`. The streak exists only in process memory; a process restart loses it and restarts at `baseMs`.

The supervision loop uses `{ baseMs: 5_000, ceilingMs: 300_000 }`. A cycle counts as unchanged when it is:

- An unchanged skip.
- An `idle` or `blocked` evaluation with the same source digest and blocked state as the previous evaluation.

`busy`, `changed`, `effect_confirmed`, and `uncertain` cycles retain the five-second retry. A lapsed progress deadline therefore re-evaluates within 300 seconds. Local and peer event hints wake the owner immediately.

While backing off, the 60-second authority tail audit waits for the next cycle. Outside backoff, the [observation gate](observation-gate.md) decides whether a wake-up runs a full cycle or only that audit. Every cycle re-reads authority, revocation, and mandate expiry before an effect can run, so a delayed wake-up cannot authorize work.

Tests cover the backoff sequence and its resets.
