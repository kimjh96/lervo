# Foundation readiness v1

Status: `accepted`

As of: 2026-09-01

## Scope

This evidence closes FH5 by composing, without replacing, the checked compatibility,
causality, resource, performance, adverse-condition, capacity, release, distribution,
and retrieval-drift proofs. The machine-readable report is
[`foundation-readiness-v1.json`](foundation-readiness-v1.json).

The aggregate is a rebuildable projection. Canonical authority remains in repository
state, versioned events, workstreams, assignments, managed runs, verification, and CAS
artifacts. Passing this report grants no execution, retry, deployment, or product
authority.

## Observation contract

The runner requires three consecutive complete observations against one exact source
revision. Each observation executes all of these independent gates:

1. public compatibility, causality, resource, stage, effect, adapter, and report contracts;
2. mixed event replay, SQLite rows, writer activation and recovery, sync, and Hub HTTP;
3. the checked performance, recovery, security, privacy, and capacity reports;
4. local Codex and Claude managed journeys and Node-hosted managed journeys;
5. a no-local-state Git clone, offline dependency installation, CLI build, and a new
   local project initialized without Hub;
6. release manifest, SBOM, unsigned statement, built CLI, Hub, Node, standalone
   distributions, packed consumer installation, and registry publication preflight;
7. natural-language retrieval and grounding drift; and
8. release-completion classification against the recorded task base.

A missing gate, source drift, suite drift, constituent-report drift, failed command, or
fewer than three observations invalidates the report. Repeated success never fills in a
missing observation.

The accepted machine report contains three consecutive passed observations with eleven
checks in each observation. It binds the exact source revision, environment, task base,
constituent report bytes, focused suite bytes, durations, bounded output hashes, known
unsupported states, and its own deterministic identity.

## Boundaries and limitations

- Direct provider sessions remain `unmanaged`; whole-task token use is unavailable.
- Arbitrary third-party code remains disabled pending a revocable isolation boundary.
- The deterministic Codex and Claude journeys verify adapter-neutral behavior without
  claiming live external-provider availability.
- Temporary-clone verification proves clean local installation and operation on the
  observed environment, not every operating system or machine class.
- Billing reconciliation and autonomous monetary hard stops remain outside foundation
  readiness.

## Reproduction

After committing implementation sources, refresh constituent evidence, then run:

```text
pnpm foundation:readiness:run --base <task-base> \
  --write docs/evidence/foundation/foundation-readiness-v1.json --summary
pnpm foundation:check
```

The source revision excludes only rebuildable foundation JSON and generated repository
knowledge projections. Editing contracts, tests, scripts, documentation, manifests, or
other tracked source invalidates the checked report.
