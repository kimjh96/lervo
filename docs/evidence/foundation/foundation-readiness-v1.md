# Foundation readiness v1

Status: `accepted`

As of: 2026-09-01

## Scope

This evidence closes FH5 by composing, without replacing, the checked compatibility, causality, resource, performance, adverse-condition, capacity, release, distribution, and retrieval-drift proofs. The machine-readable report is [`foundation-readiness-v1.json`](foundation-readiness-v1.json).

The aggregate is a rebuildable projection. Canonical authority remains in repository state, versioned events, workstreams, assignments, managed runs, verification, and CAS artifacts. A passing report grants no execution, retry, deployment, or product authority.

## Observation contract

The runner requires three consecutive, complete observations against one exact source revision. Each observation runs these independent gates:

1. Public compatibility, causality, resource, stage, effect, adapter, and report contracts.
2. Mixed event replay, SQLite rows, writer activation and recovery, sync, and Hub HTTP.
3. Checked performance, recovery, security, privacy, and capacity reports.
4. Local Codex and Claude managed journeys and Node-hosted managed journeys.
5. A no-local-state Git clone, offline dependency installation, CLI build, and new local project initialization without Hub.
6. Release manifest, SBOM, unsigned statement, built CLI, Hub, Node, and standalone distributions; packed consumer installation; and registry-publication preflight.
7. Natural-language retrieval and grounding drift.
8. Release-completion classification against the recorded task base.

A missing gate, source drift, suite drift, constituent-report drift, failed command, or fewer than three observations invalidates the report. Repeated success never substitutes for a missing observation.

The accepted machine report contains three consecutive passing observations with eleven checks each. It binds the exact source revision, environment, task base, constituent-report bytes, focused-suite bytes, durations, bounded-output hashes, known unsupported states, and its own deterministic identity.

## Boundaries and limitations

- Direct provider sessions remain `unmanaged`; whole-task token use is unavailable.
- Arbitrary third-party code remains disabled until a revocable isolation boundary exists.
- Deterministic Codex and Claude journeys verify adapter-neutral behavior without claiming live external-provider availability.
- Temporary-clone verification proves clean local installation and operation only for the observed environment, not every operating system or machine class.
- Billing reconciliation and autonomous monetary hard stops remain outside foundation readiness.

## Reproduction

After committing implementation sources, refresh constituent evidence, then run:

```text
pnpm foundation:readiness:run --base <task-base> \
  --write docs/evidence/foundation/foundation-readiness-v1.json --summary
pnpm foundation:check
```

Foundation evidence runners resolve the repository Prettier configuration and write final formatted JSON before readiness hashes constituent reports. Consequently, `pnpm format:check` must pass immediately after generation without changing an evidence file. Post-generation formatting invalidates the readiness binding and requires new observations.

The source revision excludes only rebuildable foundation JSON and generated repository-knowledge projections. Changes to contracts, tests, scripts, documentation, manifests, or other tracked source invalidate the checked report.
