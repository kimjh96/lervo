# Guarded refusals and installed Shiflo acceptance

## Lervo authority, upgrade fences, and source drift

Lervo extension `kstruct_166575e3bfe08a71d346d98e` subsequently applied with unchanged suite/roots/roles/ceilings, expiring 19:00 UTC. r159's source-drifted verification exited at 16:24:41 UTC. Fresh assessment/review completed, but canonical integration failed its exact assignment at event 51931, 16:39:11 UTC, with `repository_changed_during_verification`. Proof `sha256:0487d7a85419ca32a54d9ebf94e6bfedcfbe0ec370581ce03286978e60b9446f` confirms candidate revision changed during commands without identifying safe integration. Lifecycle retained a scheduled retry.

Repeated r160 upgrades refused `service_upgrade_supervision_busy`; one crossed that fence but refused `service_upgrade_work_busy`. r159 remained active, protecting ongoing work.

The same Lervo integration assignment reopened/claimed at event 52035, 16:46:29 UTC, then failed again at event 52036, 16:52:34 UTC, with `repository_changed_during_verification`. Its Git-clean retained worktree contained ignored `packages/capabilities/tsconfig.tsbuildinfo` outside snapshot exclusions, created at 16:31:31 UTC during first verification. Only `@lervo/capabilities` among composite packages omitted `tsBuildInfoFile`; all others use excluded `dist/.tsbuildinfo`.

This cache is a concrete likely source, but the proof has no before/after path diff; fresh candidate confirmation remains required. Configuration now directs the cache to `dist/.tsbuildinfo`, preserving fail-closed snapshots and tracked asset coverage. Focused Mac build passed and emitted the new path.

## Scoped installed Shiflo acceptance

Shiflo grant `kstruct_1a0f07d497df88cbb2b571a6` renewed unchanged scope/ceilings through 19:00 UTC. Its r160 service was active at PID 1661848 with ready conversation/sync. Installed review event 9423 at 16:40:28 UTC, result `sha256:c7b0d5aff08112de6d1156a3e459c8186380a2939cb60550159cdd5fa4cacf2a`, approved the batch containing `.agents/skills/app-store-screenshot-kit/scripts/generate.mjs`.

Its 11-document context contained all three previously omitted children, with hashes:

- `sha256:c92085aea72b71f0cd9d57547bd90c35f91005a9298aff2d01a17a55dae250fe`
- `sha256:f4d705b542daf5f912684f93e70e28c2ea02cef9716750fc8f36248e23096637`
- `sha256:6f40eae3ad3458cd9984cf3c5e5706e5611626a769b7cce8f84ec3eee6e644c5`

Assessment quoted preview-capture passages of 559/1,022 characters, composition of 1,368 characters, and invocation of 809 characters. Independent review approved all three dispositions. Two other screenshot-kit batches received accepted review/integration. Overall assessment continued with one obligation; scoped acceptance does not prove complete currency.
