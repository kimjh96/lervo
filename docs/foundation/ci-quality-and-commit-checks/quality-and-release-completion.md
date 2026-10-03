# Quality and release completion

In `.github/workflows/code-quality.yml`, the `quality` job first runs `pnpm quality:check`. The subsequent release-completion step selects an explicit base by event:

- Pull request: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Push to `main`: `pnpm release:completion:check --base "${{ github.event.before }}"`.

The workflow defines no alternative base when that coordinate is unavailable. These steps bind release inspection to event-specific Git evidence; the quality check alone does not establish release completion.

See [CI quality and commit checks](../ci-quality-and-commit-checks.md) for shared configuration and evidence boundaries.
