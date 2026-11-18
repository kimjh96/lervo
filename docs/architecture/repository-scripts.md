# Repository script architecture

Status: `active`

As of: 2026-09-04

## Purpose

Repository automation is production infrastructure. Its layout must expose ownership, dependency direction, test scope, and release impact without relying on filenames or historical knowledge.

## Ownership layout

```text
scripts/
  distribution/                 standalone artifacts, installed runtimes, and services
  evaluation/                   current evaluation commands and their tests
  natural-language-evaluation/  evidence-bound evaluation implementation
  quality/                      repository quality checks and their implementations
  release/                      release commands, release policy, and first publication
  shared/                       dependency-free script contracts used by multiple domains
```

Tests live in the owning domain's `test/` directory. Private implementations live in the owning domain or its `lib/` directory. First-publication code is divided by transition, metadata, workflow, stage, evidence, adapters, and shared lifecycle concerns. Create a new directory only with its first artifact.

`natural-language-evaluation` is an evidence boundary, not a second evaluation domain: reviewed canary contracts bind exact source paths and bytes there. New evaluation code belongs in `scripts/evaluation/` unless a new reviewed evidence contract explicitly requires otherwise.

## Dependency direction

```text
release -> distribution -> shared
       \-----------------> shared

evaluation -> evaluation-owned implementation
foundation -> foundation-owned implementation
quality -> quality-owned implementation
```

`shared` contains only low-level contracts and cannot depend on an owning domain. Release may compose distribution verification and packaging, but distribution cannot import release orchestration. Evaluation, foundation, and quality cannot access another domain's private implementation. Production modules cannot import test-owned modules.

`repository-scripts:check` validates these edges and relative script imports, verifies repository-relative execution references, rejects unowned root artifacts, and confirms that every `package.json` Node command uses an owned entrypoint. It runs as part of `quality:check`.

## Entrypoint and implementation boundary

Package and workflow entrypoints translate arguments, invoke one owner, render a bounded result, and set exit status. Reusable parsing, policy, filesystem effects, process control, and report construction belong in importable domain modules. The runtime-service manager, real managed-provider HTTPS pilot, and lexical-v2 provider comparison use thin entrypoints; their independently testable implementations do not share the command boundary.

A module reaching the long-module threshold requires the exact-content review defined by the [code convention](../foundation/code-convention.md). Review certifies one cohesive responsibility; it does not waive unresolved mixed responsibilities. If a change introduces another reason to change, split the module before refreshing its hash.

## Evidence-bound root exception

`scripts/run-linked-evidence-managed-canary-v18.mjs` is the only permitted root executable. Its exact SHA-256 digest is fixed by the reviewed V18 canary evidence. Moving or rewriting it would change historical source evidence, so the architecture check verifies its bytes. Replacing this exception requires a separate evidence migration that preserves historical coordinates; ordinary cleanup cannot mutate it.

No other root `.mjs` file, flat `scripts/lib`, or flat `scripts/test` ownership is allowed.

## Extension procedure

When adding repository automation:

1. Choose the domain that owns the policy or effect; do not classify by command verb alone.
2. Put the stable command adapter at an owned entrypoint and its implementation beside the owner.
3. Keep tests with that domain. Use `shared` only after two current domains need the same dependency-free contract.
4. Update `package.json`, workflows, documentation, release-impact classification, and focused tests in the same change.
5. Run `pnpm repository-scripts:check`, `pnpm quality:check`, relevant tests, and the exact-base release-completion check.

Scripts entering the CLI, Hub, Node, standalone distribution, or service-management closure retain the release-intent rules in [CLI version and release management](../distribution/cli-version-management.md).
