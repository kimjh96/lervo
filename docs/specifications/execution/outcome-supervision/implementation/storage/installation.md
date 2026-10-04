# Reviewed local mandate installation

The CLI installs without a Hub. Installation requires explicit event writer version 3 activation, one repository, one canonical team, and an active workstream with an exact snapshot event.

Version 1 mandates reject Hub-enabled installation. Version 2 permits a [reviewed designated execution host](../execution-host.md), preserving synchronization and verifying that host's local history without claiming cross-device history convergence.

- [Review and apply](installation/review-and-apply.md): commands, review bindings, source validation, and fenced installation.
- [Evidence and recovery](installation/evidence-and-recovery.md): artifacts, journal recovery, replay, revocation, storage bounds, and tests.
- [CLI adapter checks](installation/cli-adapter-checks.md): scope selection, planning, installation, inspection, revocation, and preflight resolution.
