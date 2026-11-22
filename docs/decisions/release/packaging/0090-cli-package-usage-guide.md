# ADR-0090: CLI package usage-guide contract

Status: `accepted`
Decision date: 2026-08-20

## Context

The package lacked installation and first-use guidance, while the root README was too detailed. Metadata lacked a description, keywords, and license. Canonical repository, homepage, and issue URLs and an open-source license were undecided and must not be invented.

## Decision

- Maintain a package-specific English `apps/cli/README.md`, not an automatically generated root excerpt.
- Keep it below 4 KiB with exactly three sections: Prerequisites, Install, and First run. Include Node 22.13+, global npm installation, `lervo init --name my-project`, dry-run, help, Hub-free init/help, and separate provider configuration.
- Exclude long command lists, implementation status, ADR inventory, and changelog.
- Use one English package description, keywords `ai-agents`, `local-first`, and `orchestration`, and license `Apache-2.0`, the license of the repository since it became public on 2026-11-23. `pnpm pack` copies the repository `LICENSE` into the package, so release manifest schema 11 lists it among the archive files with its size and digest. Earlier schemas refuse it. A host already running 0.34.1 accepts it, because the host checks the tarball against the manifest's own file list. Omit unknown repository, homepage, and bugs URLs until separately decided.
- Manifest schema v3 binds description, keywords, license, and README bytes/hash. Permit exactly the README, bundle, and package manifest in the public archive, plus the repository `LICENSE` from schema 11.
- Packed and deployment smokes verify installed metadata, files, README size, title, sections, and required commands.
- Add no runtime event, state, or telemetry.

## Consequences

Users can reach initialization from npm or the installation source, and drift fails release checks. This proves only local package guidance, not registry publication, ownership, support, provider execution, or legal licensing.
