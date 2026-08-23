# ADR-0090: CLI package usage-guide contract

Status: `accepted`
Decision date: 2026-08-20

## Context

The package lacked install/first-use guidance, while root README was too detailed. Metadata lacked description/keywords/license, but canonical repository/homepage/issues and open-source license were undecided and must not be invented.

## Decision

- Maintain a package-specific English `apps/cli/README.md`, not an automatic root excerpt.
- Keep it under 4 KiB with three sections—Prerequisites, Install, First run—and include Node 22.13+, global npm install, `lervo init --name my-project`, dry-run, help, Hub-free init/help, and separate provider configuration.
- Exclude long command lists, implementation status, ADR inventory, and changelog.
- Package manifest uses one English description, keywords `ai-agents`, `local-first`, `orchestration`, and `UNLICENSED`. Omit unknown repository/homepage/bugs URLs until separately decided.
- Manifest schema v3 binds description/keywords/license and README bytes/hash. Permit exactly README, bundle, and package manifest in public archive.
- Packed/deploy smokes verify installed metadata, files, README size/title/sections/required commands.
- Add no runtime event/state/telemetry.

## Consequences

Users can reach initialization from npm/install source, and drift fails release checks. This proves local package guidance only—not registry publication, ownership, support, provider execution, or legal licensing.
