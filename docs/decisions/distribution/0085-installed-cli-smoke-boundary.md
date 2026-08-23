# ADR-0085: Installed CLI artifact smoke boundary

Status: `accepted`
Decision date: 2026-08-20

Later ADR-0087 bundles internals; ADR-0090 adds package README and metadata checks.

## Context

Source tests and builds do not prove the installed version, bin, dist output, or runtime dependencies. The 0.1.0 trace transition could pass source fixtures while an installed package ran stale output. Deployment smoke should reuse the larger cursor fixture rather than duplicate it.

## Decision

- Add storage-free `lervo --version` and `lervo -v`, printing exactly one `lervo <semver>` line from the packaged `package.json`. An invalid or unavailable version returns source-free `cli_version_unavailable`. Reject trailing arguments.
- `pnpm smoke:built-cli` builds the workspace, creates an isolated production deployment with `pnpm deploy --prod`, and runs the installed `dist/bin.js` from another project working directory.
- Require root, source, and installed versions to match; require bin to target `./dist/bin.js`; and require version output to match with empty stderr.
- Read installed `trace --capabilities` and verify the page default, implicit mode, and absence of deprecation.
- Initialize through the installed CLI, write two fixed synthetic events using independently built project storage, then verify default page v1 without status and explicit completed full v1 against the same events.
- Use no user repository or payload. Remove temporary installation and project data on success or failure.
- Keep 50/51 pagination continuity solely in the ADR-0083 fixture.

## Consequences

`pnpm check` detects stale or missing dist output, version/bin mismatches, and deployed dependency omissions. It proves only local lockfile/store deployment, not registry or global shims, provider authentication, or managed runs.
