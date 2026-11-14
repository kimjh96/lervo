#!/usr/bin/env bash
# Shared release-preparation effects for the fallback release branch and prepared pull requests.
# Callers source this file under `set -euo pipefail`; every failure stops before any push.

release_bot_name='lervo-release[bot]'
release_bot_email='lervo-release[bot]@users.noreply.github.com'
release_prepare_subject='chore(cli): prepare release'

# Applies the exact approved plan through its owners and commits only release-owned paths.
release_preparation_commit() {
  local plan_id="$1"
  pnpm release:prepare --apply --approval "${plan_id}" --json
  git add apps/cli/package.json apps/cli/release-artifact-manifest.json apps/cli/release-sbom.cdx.json pnpm-lock.yaml .changes
  git -c user.name="${release_bot_name}" -c user.email="${release_bot_email}" commit -m "${release_prepare_subject}"
  pnpm release:manifest:check
  pnpm release:sbom:check
}

# Proves the prepared HEAD against the completion base, changes nothing beyond release-owned paths
# relative to its source, and leaves a clean worktree.
release_preparation_verify() {
  local source_sha="$1" completion_base="$2"
  pnpm release:completion:check --base "${completion_base}"
  while IFS= read -r changed_path; do
    case "${changed_path}" in
      apps/cli/package.json|apps/cli/release-artifact-manifest.json|apps/cli/release-sbom.cdx.json|pnpm-lock.yaml|.changes/current-release.md|.changes/relint_*.yaml) ;;
      *) echo "Unexpected release preparation path: ${changed_path}" >&2; return 1 ;;
    esac
  done < <(git diff --name-only "${source_sha}" HEAD)
  test -z "$(git status --porcelain)"
}

# Prints the exact plan ID from `pnpm release:prepare --json` output and fails on anything else.
release_plan_id() {
  [[ "$1" =~ \"planId\":[[:space:]]*\"(relprep_[a-f0-9]{24})\" ]] ||
    { echo 'release_plan_invalid' >&2; return 1; }
  printf '%s' "${BASH_REMATCH[1]}"
}

# Dispatches full Code quality for the exact prepared commit unless a successful or active
# dispatch for that commit on that branch already exists.
release_verification_dispatch() {
  local branch="$1" commit="$2" base="$3" runs total
  runs="$(gh api --method GET "repos/${GITHUB_REPOSITORY}/actions/workflows/code-quality.yml/runs" \
    -f head_sha="${commit}" -f event=workflow_dispatch -F per_page=100 \
    --jq '"total \(.total_count)", (.workflow_runs[] | select(.conclusion == "success" or .status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "pending" or .status == "requested") | "\(.head_sha) \(.head_branch)")')"
  total="$(sed -n 's/^total //p' <<<"${runs}")"
  test "${total}" -le 100
  if ! grep -Fxq "${commit} ${branch}" <<<"${runs}"; then
    gh workflow run code-quality.yml --ref "${branch}" -f expected_sha="${commit}" -f base_sha="${base}"
  fi
}
