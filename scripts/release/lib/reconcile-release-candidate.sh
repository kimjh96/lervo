#!/usr/bin/env bash
set -euo pipefail

if compgen -G '.changes/*.yaml' > /dev/null; then
  plan="$(pnpm release:prepare --json)"
  plan_id="$(jq -r '.planId' <<<"${plan}")"
  previous_sha="$(git ls-remote --heads origin refs/heads/lervo/release-cli | cut -f1)"
  reused=false
  if [ -n "${previous_sha}" ]; then
    git fetch origin "${previous_sha}"
    if [ "$(git rev-parse "${previous_sha}^")" = "${RELEASE_SOURCE_SHA}" ]; then
      git switch -C lervo/release-cli "${previous_sha}"
      pnpm release:completion:check --base "${RELEASE_SOURCE_SHA}"
      reused=true
    fi
  fi
  if [ "${reused}" = false ]; then
    git switch -C lervo/release-cli "${RELEASE_SOURCE_SHA}"
    git branch --set-upstream-to=origin/main lervo/release-cli
    test "$(git merge-base HEAD '@{upstream}')" = "${RELEASE_SOURCE_SHA}"
    pnpm release:prepare --apply --approval "${plan_id}" --json
    git add apps/cli/package.json apps/cli/release-artifact-manifest.json apps/cli/release-sbom.cdx.json pnpm-lock.yaml .changes
    git -c user.name='lervo-release[bot]' -c user.email='lervo-release[bot]@users.noreply.github.com' commit -m 'chore(cli): prepare release'
    pnpm release:manifest:check
    pnpm release:sbom:check
  fi
  pnpm release:completion:check --base "${RELEASE_SOURCE_SHA}"
  while IFS= read -r changed_path; do
    case "${changed_path}" in
      apps/cli/package.json|apps/cli/release-artifact-manifest.json|apps/cli/release-sbom.cdx.json|pnpm-lock.yaml|.changes/current-release.md|.changes/relint_*.yaml) ;;
      *) echo "Unexpected release preparation path: ${changed_path}" >&2; exit 1 ;;
    esac
  done < <(git diff --name-only "${RELEASE_SOURCE_SHA}" HEAD)
  test -z "$(git status --porcelain)"
  release_commit="$(git rev-parse HEAD)"
  body_file="${RUNNER_TEMP}/lervo-release-pr.md"
  open_pr_number="$(gh pr list --base main --head lervo/release-cli --state open --json number --jq '.[0].number // empty')"
  export RELEASE_EXISTING_PR_BODY_PATH=''
  if [ -n "${open_pr_number}" ]; then
    export RELEASE_EXISTING_PR_BODY_PATH="${RUNNER_TEMP}/lervo-release-pr-existing.json"
    gh pr view "${open_pr_number}" --json body >"${RELEASE_EXISTING_PR_BODY_PATH}"
  fi
  RELEASE_CANDIDATE_SHA="${release_commit}" RELEASE_PLAN_ID="${plan_id}" \
    node scripts/release/commands/render-release-pr.mjs >"${body_file}"
  node scripts/release/commands/check-release-ci.mjs
  if [ "${reused}" = false ]; then
    git push --force-with-lease="refs/heads/lervo/release-cli:${previous_sha}" origin HEAD:refs/heads/lervo/release-cli
  fi
  node scripts/release/commands/check-release-ci.mjs
  if [ -z "${open_pr_number}" ]; then
    gh pr create --base main --head lervo/release-cli --title 'chore(cli): prepare release' --body-file "${body_file}"
  else
    gh pr edit "${open_pr_number}" --title 'chore(cli): prepare release' --body-file "${body_file}"
  fi
  node scripts/release/commands/check-release-ci.mjs
  candidate_runs="$(gh api --method GET "repos/${GITHUB_REPOSITORY}/actions/workflows/code-quality.yml/runs" \
    -f head_sha="${release_commit}" -f event=workflow_dispatch -F per_page=100)"
  test "$(jq '.total_count' <<<"${candidate_runs}")" -le 100
  existing="$(jq --arg sha "${release_commit}" '[.workflow_runs[] | select(.head_sha == $sha and .head_branch == "lervo/release-cli" and (.conclusion == "success" or .status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "pending" or .status == "requested"))] | length' <<<"${candidate_runs}")"
  if [ "${existing}" -eq 0 ]; then
    gh workflow run code-quality.yml --ref lervo/release-cli -f expected_sha="${release_commit}" -f base_sha="${RELEASE_SOURCE_SHA}"
  fi
  echo 'disposition=release_pr' >>"${GITHUB_OUTPUT}"
else
  echo 'disposition=tag_check' >>"${GITHUB_OUTPUT}"
fi
