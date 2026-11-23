# Linked child contracts and assignment leases

## Bounded context loading

Shiflo's rejection exposed context selection: the eight-document window for three screenshot-kit source paths included `reproduction.md` but excluded its three linked children. ADR-0443 adds policy-constrained child loading with exact hash fencing. Full-window, excluded-sensitive-child, and aggregate-byte-refusal tests passed; all six context-package tests passed. A real Mac probe included `reproduction/preview-capture.md`, `reproduction/composition.md`, and `reproduction/invocation.md` with exact hashes.

Full Mac build, quality, 478-document lifecycle, manifest/SBOM, and task-base release completion passed with patch intent pending. Migration produced ready `kplan_007f30944e6d1b6a9585f5ea`; lint was valid. At this boundary the change was local source only: Shiflo still required renewed authority, runtime upgrade, substantive quotations, and accepted current review. Concurrent Lervo apply used preceding WSL bytes and could not validate the loader.

## Assignment renewal and r160 staging

That Lervo apply passed three shards but failed the fourth. `ver_f0beec358b13e3cb`, result `sha256:e8c394bf40ecde59eca8dbca87124790d6b1fee795afce45a270a90bfc2a77c7`, records shard durations of 361.96/785.86/435.85/359.44 seconds. Shard four had 973 passing tests and `canonical-workset-convergence` timing out at 90 seconds, followed by `ENOTEMPTY`. Writer `asn_6b4e307ff9d6658b520487dd`, claimed at 15:07:28 UTC, expired at 15:37:28 UTC before shard four ended. Failure bookkeeping could not settle the expired exact claim; outbox retained `knowledge_job_transient_failure`, not an applied receipt.

ADR-0627 adds bounded exact assignment renewal under the current 60-minute stage lease. The complete-workset test now permits 240 seconds with unchanged assertions. Focused Mac lease/workset tests passed three cases; no installed pass was observed. Private fixes share patch intent `relint_e364b459072d83d6fc29803a` because pending release intent reached its 128-item bound.

Exact SHA-256 copies of 15 source/documentation files advanced WSL's private ref to `42e327645cd91ba9e82d4490a134100f1767f681` without changing its working branch. Linux full build, manifest, and SBOM checks passed. Lease/workset tests passed 3/3; busy-host workset time was 88.51 seconds, near the old 90-second deadline.

r160 archive `sha256:af82403cdb5ef1dc27938e2c163cbb137d7c9b4ed15829ce114591675971ecc6` verified, installed immutably, and passed preflight. Upgrade refused `service_upgrade_supervision_busy` during the old active cycle, retaining r159. Same-scope extension `kstruct_166575e3bfe08a71d346d98e` through 19:00 UTC was initially prepared/planned, not applied. r160 installed apply/currency remained unobserved.
