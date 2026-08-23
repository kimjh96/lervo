# ADR-0085: Installed CLI artifact smoke boundary

Status: `accepted`
Decision date: 2026-08-20

Later ADR-0087 bundles internals; ADR-0090 adds package README/metadata checks.

## Context

Source tests/build do not prove installed version/bin/dist/runtime dependencies. The 0.1.0 trace transition could pass source fixtures while an installed package executes stale output. Deployment smoke should reuse, not duplicate, the larger cursor fixture.

## Decision

- Add storage-free `lervo --version`/`-v`, printing one `lervo <semver>` line from packaged `package.json`; invalid/unavailable version is source-free `cli_version_unavailable`. Reject trailing arguments.
- `pnpm smoke:built-cli` builds the workspace, creates an isolated production `pnpm deploy --prod`, and runs installed `dist/bin.js` from another project cwd.
- Require root/source/installed versions equal; bin points to `./dist/bin.js`; version output matches with empty stderr.
- Read installed `trace --capabilities` and verify page default/implicit mode/no deprecation.
- Initialize with installed CLI, write two fixed synthetic events using independently built project-storage, then verify default page v1 without status and explicit completed full v1 over the same events.
- Use no user repository/payload and remove temporary install/project on success or failure.
- Keep 50/51 pagination continuity solely in ADR-0083 fixture.

## Consequences

`pnpm check` catches stale/missing dist, version/bin mismatch, and deployed dependency omissions. It proves only local lockfile/store deployment—not registry/global shim/provider auth/managed run.
