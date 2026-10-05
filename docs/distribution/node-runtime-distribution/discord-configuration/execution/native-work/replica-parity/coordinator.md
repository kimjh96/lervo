# Coordinator bounds and watches

Coordinator `peer.commandTimeoutMs` bounds each finite SSH operation and defaults to 60 seconds. `maximumConcurrency` bounds independent reconciliations from one through four. Use one for a Windows-to-WSL command bridge that cannot safely sustain parallel `wsl.exe` launches. A deadline or transport failure produces no readiness receipt and cannot occupy a reconciliation slot forever.

Set coordinator `peerWatch` to `false` when the bridge cannot safely retain one SSH/WSL watch process per repository. Local changes remain event-driven; finite snapshot commands detect peer changes at `pollIntervalMs`, subject to idle recovery back-off. This avoids persistent bridge saturation without weakening exact snapshot or conflict verification.

While every replica stays `current`, the recovery sweep backs off from its base interval to `idleRecoveryCeilingMs` (default 600 seconds; accepted range 30–3,600 seconds). Any change hint or non-current cycle resets it to the base. A fingerprint-keyed snapshot cache in each Git directory observes unchanged trees without re-hashing the worktree.

A strict topology whose peer requires readiness must keep `peerWatch` enabled: a backed-off sweep exceeds maximum readiness staleness.
