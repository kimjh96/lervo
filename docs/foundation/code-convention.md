# Code convention

Status: `active`
As of: 2026-08-25

This convention governs implementation and review. Before editing and completion, assess touched modules against its responsibility and splitting rules. Automated quality, architecture, type, and test gates support but do not replace structural review.

Production modules of at least 400 lines require exact-content review in `scripts/code-convention-reviews.json`. A new, changed, or no-longer-large module fails `pnpm code-convention:check` until reviewed again. The registry is not a debt allowlist: fix confirmed responsibility violations before recording a cohesive module, and never update a content hash without repeating the review.

## Design priorities

Apply these priorities in order:

1. Preserve domain, evidence, privacy, and failure contracts.
2. Clarify responsibilities and dependency direction.
3. Keep change impact local and behavior independently testable.
4. Reuse a stable concept only when current code proves it is shared.
5. Optimize measured bottlenecks without weakening earlier priorities.

Prefer explicit names and data flow over abbreviations, hidden conventions, or reconstructed control flow. Shorter code is not simpler when it conceals ownership, failures, or side effects.

## Responsibilities and boundaries

Each module needs one cohesive responsibility and primary reason to change. Separate behavior with independently changing policy owners, failure meanings, data lifecycles, or external systems.

- Entrypoints parse input, invoke application behavior, translate results, and select exit status. Dedicated modules own validation, domain decisions, persistence, rendering, and provider behavior.
- Domain code owns invariants and decisions. It must not depend on CLI, HTTP, filesystem, database, Codex, or Claude details.
- Orchestration composes domain behavior and ports. It may sequence effects but must not duplicate adapter policy or hide domain decisions in callbacks.
- Each adapter owns one external boundary and translates native inputs, outputs, and failures into common contracts. Provider-specific behavior ends at provider adapters.
- Persistence owns storage mechanics, not product policy. Rendering owns representation, not mutation or authorization.
- Separate pure evaluation and rendering from mutation. Shared helpers must not make dry-run or plan paths effectful.

Do not collect unrelated behavior in generic `manager`, `service`, `helper`, or `utils` modules. Name modules for their responsibility; names requiring unrelated nouns usually indicate an overly broad boundary.

## Colocation and public surfaces

Keep implementations, private types, constants, and focused tests near their owning responsibility. Promote code to shared modules or packages only when multiple current callers share its semantics and lifecycle.

- Expose only the smallest stable public package surface consumers need. Do not export symbols solely for internal tests or neighboring implementations.
- Import through public package contracts, never another package's internal paths.
- Facades and barrels may provide stable entry surfaces but must not contain business logic or create circular dependencies.
- Keep shared types with the defining contract. Do not create global type or constant collections merely for reuse.
- Create directories with their first real artifact, not as speculative hierarchies.

Prefer local duplication to premature abstraction. Extract only when current callers need the same invariant and accept the same change lifecycle; similar syntax is insufficient.

## Module splitting

File length is a review signal, not a target. Split independently understandable responsibilities even in short modules. Review for splitting when:

- parsing or transport handling mixes with domain decisions;
- pure evaluation or rendering mixes with filesystem, network, database, process, or event mutation;
- one module integrates multiple external systems;
- unrelated policy changes repeatedly touch the same file;
- tests need distinct fixture families or extensive mocks for independent behavior;
- an entrypoint is no longer a short composition of named operations;
- a source file reaches 400 lines and has another listed signal.

When at least two semantic signals exist, separate them in the current change if touched behavior can move without changing its contract. If extraction would materially increase delivery risk, record one bounded follow-up naming the exact responsibility and verification; never leave a generic refactoring note.

Split by responsibility, not line ranges. Preserve a stable facade when callers or scripts depend on its path, moving implementation behind it. Length alone does not require splitting declarative schemas, fixtures, protocol catalogs, or generated sources, but keep their consuming logic separate.

## Extension and maintenance

Prefer bounded implementations behind existing ports or strategies over provider, storage, or transport branches in core logic. Add abstractions only for a current variation or contract.

Repository-authored state must have bounded growth and retention. Do not append indefinitely to one file or replace that pattern with one file per event, run, release, date, or version in a single directory. When the working tree needs a current projection, keep it bounded. Store durable history in an existing canonical system such as Git, an event store, or an explicitly retained external release record. Define compaction or pruning before introducing any collection whose cardinality can grow with operation count. Tests and fixtures may use bounded collections owned by their test lifecycle.

- Dependencies flow from applications and adapters toward domain contracts. Core packages never import provider adapters or application entrypoints.
- Pass dependencies explicitly at composition boundaries. Avoid mutable process-wide singletons and helpers that invisibly read time, randomness, environment, filesystem, or network state.
- Model behavioral variation with named values or strategies, not accumulating booleans with undocumented combinations.
- Keep one authoritative implementation of each invariant. Adapters may translate but not redefine it.
- Preserve typed, stable failure meanings across boundaries. Translate failures where sufficient context exists; do not swallow them or collapse distinct states into a generic error.
- Prefer additive, backward-compatible stable-contract changes. Remove or reshape a contract only when callers, migration, documentation, and verification are in scope.

Begin performance work with a reproducible observation. Optimize the measured phase, retain a clear baseline or differential comparison where practical, and preserve determinism and boundary clarity.

## Testability

Tests follow responsibility boundaries rather than compensating for broad modules.

- Test pure decisions without external systems.
- Give every adapter the common contract suite and focused native-boundary cases.
- Test orchestration sequencing, rollback, and failure propagation with explicit port fakes.
- Add regression coverage before or alongside responsibility-preserving extraction.
- Ensure every new test is included by an executed repository test command.

Moved code still requires verification at its new boundary. End-to-end success does not replace focused coverage for independently testable domain decisions or failure mappings.

## Comments and temporary work

Use structure and names to explain behavior. Comments should preserve only inexpressible reasons: security or compatibility constraints, non-obvious ordering, external limits, or a still-relevant rejected alternative.

Do not narrate code, retain change history, or substitute comments for abstractions. A `TODO` or temporary exception must name its removal condition and a traceable owner or issue when one exists.

## Review checklist

Before completing a source change, confirm:

1. Every touched module has a cohesive owner and primary reason to change.
2. Domain policy, orchestration, I/O, provider translation, and rendering are not accidentally coupled.
3. Entrypoints and public facades remain short and contain no independent implementation concern.
4. Dependencies follow package direction; external effects cross explicit ports or adapters.
5. Growing files were assessed against split signals, with bounded recorded deferrals.
6. Every public export, abstraction, configuration item, and comment is currently necessary.
7. Focused tests cover changed decisions and failure mappings, and relevant suites execute them.
8. Measured performance, privacy, telemetry, documentation, and migration contracts remain true.

## Automated quality and formatting

ESLint owns code-quality defects, and Prettier owns deterministic formatting. `eslint-config-prettier` disables overlapping formatting rules; ESLint does not run Prettier.

- ESLint applies upstream recommended JavaScript and TypeScript rules to repository JavaScript, MJS, CJS, and TypeScript.
- TypeScript remains strict. `pnpm typecheck` is authoritative for type analysis; fast lint does not repeat project-wide typed analysis.
- Prettier uses two-space indentation, semicolons, double quotes, supported trailing commas, a 100-column target, LF endings, and final newlines for code and configuration.
- Browser globals apply only to `apps/hub/assets/**/*.js`; other JavaScript uses Node globals.
- Markdown with an active Lervo normalization record is excluded dynamically because the reviewed document lifecycle owns those exact bytes and external formatting would create a provider-normalization loop. Unregistered, user-owned Markdown remains under Prettier.
- Dependencies, build output, coverage, Lervo durable or rebuildable stores, generated knowledge registries and publications, generated release manifests, the generated SBOM, the pnpm lockfile, and provider instruction bridges are also excluded. Their owning checks verify documents, generated artifacts, and managed instruction blocks.
- The formatter wrapper derives lifecycle-owned paths from tracked normalization records and fails closed on malformed ownership coordinates. The same records project a parser-bounded managed block in `.prettierignore`, so direct Prettier and editor integrations honor exact/reviewed byte owners. A subtree is compacted only when every included document below it has the same exact owner; broad Markdown globs and unsafe negation remain forbidden. Static generated, durable, rebuildable, and provider-managed roots remain in the user-owned region of `.prettierignore`.

Never disable a rule repository-wide to bypass a finding. Fix the code when possible. If an exception is necessary, add a narrow inline disable beside its reason. Unused disable directives fail lint.

## Commands

```bash
pnpm lint
pnpm lint:fix
pnpm format:check
pnpm format
pnpm code-convention:check
pnpm quality:check
```

`pnpm check` includes `pnpm quality:check`. Pull requests and pushes to `main` also run the dedicated code-quality workflow. Run broad fixes only when their diff remains within the active task; otherwise format or lint only affected paths.
