# ADR-0355: Expose a versioned packed product-host protocol

- Status: accepted
- Decision date: 2026-09-03

## Context

Lervo already exposes provider-neutral workstream, workforce, governed-loop, operating-board, assignment-interaction, routine, budget, and connector behavior. Their implementation packages are workspace-private because `@lervo/cli` is the sole public release coordinate. Products in this monorepo can depend inward on those packages, but separately installed Paperclip-like or Buzz-like hosts cannot discover the supported boundary without help prose, private imports, or source-checkout knowledge.

Publishing every private package would create a multi-package compatibility and release promise before an external caller requires it. Filesystem, SQLite, graph projections, and rendered HTML cannot serve as integration APIs because doing so would bypass their owners. The product-host boundary therefore needs a small, versioned discovery contract proven from the packed public artifact.

## Decision

Add the version-1 `product_host.capabilities` report to `@lervo/application-contract`. It describes the local CLI transport, no-Hub operation, canonical authorities, rebuildable projections, exact route IDs, result-contract names, command prefixes, output form, effect class, required authority, and current availability. It also declares product UI, a product database, unattended scheduling, dynamic graph mutation, implicit approval, and unmanaged terminal execution unsupported.

Expose the report through `lervo application capabilities --json`. The command is effect-free and repository-independent. Human output is presentation only; JSON is the versioned product-host discovery form. Existing commands retain their parsers, validation, effects, failure meanings, and outputs. The report delegates no authority and does not create a facade that reimplements workforce or controller policy.

Protocol version 1 covers 21 existing routes:

- ten workforce routes for agent and assignment inspection and explicit lifecycle mutations;
- seven operating routes for objective, governed work, observed budgets, board rendering, managed attempts, completion reconciliation, and manual routine materialization; and
- four collaboration routes for assignment threads, inboxes, mentions, and connector delivery.

Read-only routes have `effect: none` and `authority: read_only`. Ordinary workforce writes retain their explicit `--write` boundary. Cancellation, reconciliation, mention, and routine mutations retain exact plan/apply where their owning commands require it. Managed attempts remain lease-bound and verification-governed. Connector planning is available, but external delivery remains `adapter_required_for_effect`; the stock CLI gains no connector authority.

Extend the packed CLI consumer check with an installation-only product-host fixture. It installs the tarball into an empty consumer, imports no workspace package, discovers the report, creates one local agent, workstream, and assignment through CLI commands, and inspects the objective, graph, budget, thread, inbox, and static board. The fixture must require neither Hub nor provider and must retain the assertion that only `@lervo/cli` is installed below the public namespace.

An incompatible route or report change requires a new protocol version. A future public SDK, long-lived local service, or direct application package requires measured need and its own release decision; it must preserve these authority and evidence meanings.

## Privacy and failure meaning

The capability report contains static contract metadata only. It includes no repository paths, workstream or assignment coordinates, prompts, content, provider output, credentials, native connector identifiers, or runtime observations. `available` means the installed CLI implements the route, not that its repository prerequisites or authority are present. `adapter_required_for_effect` means planning can be local while the external effect remains unavailable without an injected, verified adapter.

A successful packed fixture proves installation and local protocol composition on that platform. It does not prove product usability, provider execution, external delivery, Hub behavior, publication, cross-platform success, or that a future UI used the returned evidence correctly.

## Consequences

Separately installed products gain one machine-readable compatibility handshake without expanding the public npm package set or duplicating canonical state. Internal products may still use the headless packages directly while preserving the same contracts. Product UI and application-owned projections can evolve independently. A later transport can be added behind a new reviewed protocol instead of leaking current storage internals.

## References

- [Product-host protocol](../../../specifications/execution/product-host-protocol.md)
- [Governed loop and assignment graph](../../../roadmap/governed-loop-assignment-graph.md)
- [Headless governed loop](../orchestration/governed-work/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Packed CLI consumer installation](../../../decisions/distribution/0088-packed-cli-consumer-installation.md)
- [System architecture](../../../architecture/system.md)
