# Resident cycle and change fence

[ADR-0461](../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md) makes the resident knowledge owner work when inputs change, with a reconciliation ceiling for unobserved inputs.

- [Change fence and scheduling](resident-cycle/fence-and-scheduling.md): fingerprint, skip conditions, adaptive timer, wakeups, private cycle state and health evidence.
- [Observation and source cache](resident-cycle/observation-and-cache.md): reuse within full cycles, source capture and private hash-cache behavior.
- [Host-wide admission](resident-cycle/admission.md): full-cycle serialization, waiting and lease recovery.
- [Cycle cost observation](resident-cycle/cycle-cost.md): Git processes, wall time and CPU per cycle and scope.
- [Source fences](resident-cycle/source-fences.md): exact fences for effects, current checks for decisions, and the site classification.

## Validation and expected effect

Every touched surface—including tracked files, untracked files, deletes, commits, policy, delegation, candidates, events and the outbox—changes the fingerprint.

Unit tests assert:

- One discovery and one canonical replay per idle full cycle.
- Byte-identical cached and uncached captures.
- Two residents never hold full-cycle admission together.

Steady-state idle cost falls from a full capture every 60 seconds to fence checks at 1, 2, 4 and 8 minutes plus one cached full cycle every 15 minutes. That full cycle reads only files whose metadata changed.
