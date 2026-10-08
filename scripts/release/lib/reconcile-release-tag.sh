#!/usr/bin/env bash
set -euo pipefail

node scripts/release/commands/check-release-ci.mjs --full
git config user.name 'lervo-release[bot]'
git config user.email 'lervo-release[bot]@users.noreply.github.com'
plan="$(node scripts/release/commands/tag-cli-release.mjs --json || true)"
tag="$(jq -r '.tag // empty' <<<"${plan}")"
if [ "$(jq -r '.status // "blocked"' <<<"${plan}")" = 'ready' ]; then
  plan_id="$(jq -r '.planId' <<<"${plan}")"
  pnpm release:tag --apply --approval "${plan_id}" --json
  node scripts/release/commands/check-release-ci.mjs --full
  git push origin "${tag}"
fi
if [ -n "${tag}" ] && [ "$(jq -r '.status // "blocked"' <<<"${plan}")" != 'blocked' ]; then
  matrix_runs="$(
    gh api --method GET "repos/${GITHUB_REPOSITORY}/actions/workflows/cli-release-matrix.yml/runs" \
      -f branch="${tag}" -F per_page=100
  )"
  matching_runs="$(
    jq --arg sha "${RELEASE_SOURCE_SHA}" \
      '[.workflow_runs[] | select(.head_sha == $sha)] | length' <<<"${matrix_runs}"
  )"
  if [ "${matching_runs}" -eq 0 ]; then
    node scripts/release/commands/check-release-ci.mjs --full
    gh workflow run cli-release-matrix.yml --ref "${tag}"
  fi
fi
