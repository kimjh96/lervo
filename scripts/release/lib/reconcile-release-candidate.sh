#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=release-preparation-commit.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-preparation-commit.sh"

if compgen -G '.changes/*.yaml' > /dev/null; then
  plan="$(pnpm release:prepare --json)"
  plan_id="$(release_plan_id "${plan}")"
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
    release_preparation_commit "${plan_id}"
  fi
  release_preparation_verify "${RELEASE_SOURCE_SHA}" "${RELEASE_SOURCE_SHA}"
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
  release_verification_dispatch lervo/release-cli "${release_commit}" "${RELEASE_SOURCE_SHA}"
  echo 'disposition=release_pr' >>"${GITHUB_OUTPUT}"
else
  echo 'disposition=tag_check' >>"${GITHUB_OUTPUT}"
fi
