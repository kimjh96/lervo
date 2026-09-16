# Abandoned-turn recovery and observed boundary

## Initial deployed refusal

ADR-0407, linked from the entrypoint, was built from `b52f0c9f` and staged on WSL as Node `goal-afbc0153` at 2026-09-15 05:41 UTC. A recovery configuration for the first successor was derived from its installed mandate event. `recover-abandoned-turn` targeted `run_7562552f45daaa5caf72308407158623`, using the scoped unit as witness.

The command exited non-zero and wrote nothing: original run events were unchanged and no terminal appeared. Exact reason: the reviewed work scope had no canonical snapshot anchor. This was event ordering, not fence failure. Successor 1 had already been cancelled; version-3 mandate authority checked its scope against the now-current third successor. Recovery therefore reached stranded runs in the current goal but not already-settled historical goals. This was an explicit fail-closed refusal, not partial settlement.

## Historical settlement authority and witness correction

The same session removed that boundary. Historical settlement needs no current goal; it now uses narrower authority: an unrevoked, unexpired installation for the exact supervision/owner. The writer still checks admitted-plan workstream containment and holds an exclusive owner lease. A cancelled predecessor's stranded run is therefore repairable.

The witness also stopped bounding unit invocations by only their own log lines. This run occurred during silence between 04:07:04 and the next invocation at 04:13:34. Because one unit's invocations are sequential, each owns the interval until its successor starts.

Node `goal-d9360364`, revision `1491c6ba`, settled the historical run at 08:01:17 UTC. The scoped service was not restarted and remained process 907204 with zero restarts.

## Verified result and duplicate refusal

Terminal `evt_23f9eb7c709ef5313b71b8fe4bb850ad` has schema version 1, system actor, exactly `interrupted_after_turn_start`, `retryable: false`, and its diagnostic digest. Diagnostic `work.managed_abandoned_turn_failure` pins all 32 original run events. Witness identifies distinct incident invocation `41969e26` spanning 04:07:04–04:13:34, successor `62db6f62`, and current `d5f21b50`.

The run now has exactly one terminal, still no `adapter.stopped`, and still no usage record. Settlement fabricated neither shutdown nor accounting evidence.

A second command refused without writes: the incident no longer had a unique observed invocation because witness anchoring used the run's last event, now the terminal inside the live invocation without a successor. Independently, the proof's duplicate guard would reject the existing terminal among original events. Both paths fail closed, preventing double settlement.
