# Release preparation workflow evidence

`.github/workflows/release-preparation.yml` implements preparation and tag handoff from [ADR-0221](../decisions/release/packaging/0221-reviewed-cli-release-preparation.md). [CLI version and release management](cli-version-management.md) defines contributor policy; [ADR-0223](../decisions/release/packaging/0223-base-bound-cli-release-completion.md) defines source-bound completion.

## Execution and authority

The workflow accepts main-branch pushes and manual dispatch. The `cli-release-preparation` concurrency group serializes runs without cancelling an active run. The Ubuntu reconciliation job has actions, contents, and pull-request write permissions and a 120-minute timeout. This covers `pnpm check`: its full Vitest suite alone took about 46 minutes on the hosted runner in October 2026, leaving the earlier 60-minute limit insufficient for a complete run.

Checkout fetches full history and persists credentials. Setup actions use full commit SHAs; Node is fixed at 22.13.0. Package-manager caching is disabled, dependencies use the frozen lockfile, and pnpm setup has no explicit pnpm version. Push events run release completion against `github.event.before`; manual dispatch skips that step. Checkout has no explicit main ref override, so its label does not establish that manual dispatch selected main.

Repository permissions support branch, pull-request, tag, and workflow-dispatch operations. The supplied workflow has no npm staging or publication command.

## Generated release pull request

When `.changes/*.yaml` matches, the workflow creates local branch `lervo/release-cli` at `GITHUB_SHA`, sets `origin/main` as upstream, and requires the merge base to equal that source revision before planning and applying preparation.

It stages and commits release outputs, runs `pnpm check` and `pnpm lervo knowledge lint --json`, then checks the committed diff against the source revision. Only these paths are allowed:

- `apps/cli/package.json`
- `apps/cli/release-artifact-manifest.json`
- `apps/cli/release-sbom.cdx.json`
- `pnpm-lock.yaml`
- `.changes/current-release.md`
- `.changes/relint_*.yaml`

An unexpected committed path exits before remote branch reconciliation. The allowlist checks the committed diff, not independently every uncommitted workspace change.

After these commands succeed, the workflow records the release commit, aligns or creates the remote release branch at the source revision, and pushes the generated commit. It creates or updates the open pull request from that branch to main with title `chore(cli): prepare release`.

## Pull-request evidence and open review

The generated body starts at H2 and contains Summary, Scope and authority, Contract and architecture, Release impact, Verification, Knowledge and documentation, Risk and recovery, and Checklist sections. Statements are bound to the preparation plan, source revision, release commit, and workflow-run link.

The body reports successful repository checks, knowledge lint, and changed-path validation. It marks source-structure, bounded-state, ownership, documentation, and verification checklist items complete within the scope of generated release aggregation: the allowed diff contains no source module, and the current release note is the changed documentation. Canonical source documentation and roadmap evidence remain the aggregated source pull requests' responsibility. Migration and roadmap changes are recorded as inapplicable to the generated-only scope.

Two checklist items remain unchecked: the workflow cannot attest that an agent read `AGENTS.md`, and no dedicated secret scan ran. Reviewers must resolve both separately. Generated checklist text neither proves source pull-request review nor independently verifies every generated artifact's contents.

## Ref updates and recovery limits

Existing remote release refs are reset through an API request with `force=true`; absent refs are created at the source revision. A subsequent Git push publishes the generated commit. The API update supplies no expected previous ref SHA. Workflow serialization and local source checks therefore do not establish atomic protection against every external branch writer, despite the generated body's broader claim that concurrent branch changes stop the run.

A failed command stops the applicable shell step. A later run can replan from its checked-out source, but configuration alone does not prove successful recovery.

## Tag and matrix handoff

When no intent YAML matches, the workflow selects tag inspection. It captures the tag command's JSON even if the command exits unsuccessfully. A `ready` plan is applied using its plan ID, then its tag is pushed.

For a nonempty tag whose plan status is not blocked, the workflow queries up to 100 matrix runs filtered by that tag and counts runs whose `head_sha` equals `GITHUB_SHA`. It dispatches the matrix at the tag only when that count is zero. This checks run existence, not success; the shown query does not paginate beyond the requested page.

The workflow definition and generated PR text establish intended sequencing and evidence requirements. They do not establish completion of any remote run, GitHub Release, artifact verification, or npm publication.
