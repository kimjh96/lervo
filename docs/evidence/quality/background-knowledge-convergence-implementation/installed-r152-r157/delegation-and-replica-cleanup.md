# Host-local delegation and replica cleanup

## Integration and host-local authority

Shiflo passed both integration suites and advanced its integration ref to `40161734b`, recording `canonical_integration=current`. A second reviewed integration reached `current`. Normalization then correctly stopped `source_bytes_changed` after an ignore-file edit, followed by fresh assessment/review. No completed normalization batch or full currency was observed at that point.

Lervo's guarded r154 upgrade produced three ready observations at PID 3344175. Old `waiting_authority` stages referenced an expired grant: Mac/WSL had separate workforce identities, but replication overwrote WSL's reviewed renewal with Mac authority.

Both hosts added the exact convergence delegation path to `.lervo/.gitignore`; `git check-ignore` and `git clean -fdn` confirmed export/cleanup exclusion. WSL reapplied same-scope host-local grant `kstruct_77cc7ff9cc7ab1b9ad3cf486` through 03:50 UTC, followed by a new assessment. Project initialization/identity migration now emit that exact ignore rule. This local deployment did not establish the roadmap's full cross-host replica gate.

## r155 smoke and normalization progress

Offline r155 CLI initialization smoke verified the exact host-local rule in generated `.lervo/.gitignore`. `pnpm release:completion:check --base b3798091d` returned `intent_pending` for `relint_cb12f09667ad11127fb01bfb`; there was no public release.

At 02:49 UTC, Shiflo's first new normalization reduced debt 16→12; the next `normalization_generation` was active/healthy. Three lifecycle reasons and false baseline currency remained. At 02:55 UTC, a second batch reduced debt to nine and a third review queued.

## Cleanup ordering defect

Mac had no Lervo/Shiflo delegation files; WSL retained separately reviewed hashes. Replica apply resets to committed HEAD and runs `git clean -fd` before installing the incoming `.lervo/.gitignore`. An older HEAD without the ignore rule can therefore delete a target-host grant.

Cleanup now explicitly excludes that exact grant path during transition. A regression reproduced an older HEAD with a newly ignored target grant and preserved its bytes; the complete nine-test replica Git file passed. Absent Mac grants cannot count as preserved authority.

## Mac r156 installation

The Mac r156 archive verified for `darwin-arm64-none`, with SHA-256 `6754163976819e2012c103ce6dd80445890aacb7a62ce496d48859de49e9b13e`, and installed at `background-convergence-mac-r156`.

Initial LaunchAgent replacement failed `launchctl bootstrap` code 5 immediately after bootout. The exact prior plist was restored, and later bootstrap restored the old service. A bounded retry after full deregistration changed only the runtime argument to r156. Three `launchctl print` observations retained running PID 14367. This repairs later Mac cleanup, not absent Mac grants; WSL still needed the fix.

## Linux r156 installation and grant recovery

The Linux r156 archive, SHA-256 `03e0054e1729b0195b3b1aa17a77442dd56ad1066e0947a226cb68a24f6b1666`, verified and installed immutably. Before the coordinator's WSL peer executable changed, a real Lervo apply deleted WSL's grant, confirming bidirectional risk.

Only `peer.remoteRuntimeExecutable` changed to r156; the coordinator restarted at PID 21712. The same reviewed WSL grant was replanned from absence and reapplied with hash `sha256:4d12678025fd2de75faed97433dd88ce7f3f2067fae3f0b4cbf44c92ef7b7ad6`. A new root assessment reached current at 03:15 UTC. Linux's nine replica tests passed; complete preservation through a later installed replica cycle remained unproven.
