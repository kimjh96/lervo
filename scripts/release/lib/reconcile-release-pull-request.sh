#!/usr/bin/env bash
# Prepares the CLI release inside one same-repository pull request. The checked-out head gains one
# bot-authored preparation commit on top of current main, and full Code quality is dispatched for
# that exact commit, so the bytes a later tag names are verified before merge.
# Usage: reconcile-release-pull-request.sh <pull-request-worktree>
# This tooling may come from a newer revision than the worktree it prepares; every pnpm owner
# command runs from the worktree, so the prepared bytes come from that revision's owners.
set -euo pipefail
# shellcheck source=release-preparation-commit.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-preparation-commit.sh"
cd "${1:?pull-request worktree}"

fail() {
  echo "$1" >&2
  exit 1
}

: "${PR_NUMBER:?}" "${PR_HEAD_REF:?}" "${PR_HEAD_SHA:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_OUTPUT:?}"
git check-ref-format --branch "${PR_HEAD_REF}" >/dev/null || fail 'release_pull_request_ineligible'
case "${PR_HEAD_REF}" in main|lervo/release-cli) fail 'release_pull_request_ineligible' ;; esac
test "$(git rev-parse HEAD)" = "${PR_HEAD_SHA}" || fail 'release_pull_request_superseded'
git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
main_sha="$(git rev-parse refs/remotes/origin/main)"
git switch -C "${PR_HEAD_REF}" "${PR_HEAD_SHA}"

# Linux cannot compile the darwin native files that the preparation commits, so a Linux runner
# prepares only with the verified build the route job found (ADR-0593); without it nothing is
# prepared. macOS compiles them with the pinned Xcode (ADR-0581).
restore_native_build() {
  [ "$(uname -s)" = Darwin ] && return 0
  [ -n "${NATIVE_REUSE_DIRECTORY:-}" ] || fail 'release_native_build_unavailable'
  node scripts/distribution/native-runtime-reuse.mjs restore "${NATIVE_REUSE_DIRECTORY}" ||
    fail 'release_native_build_unavailable'
}

is_preparation_commit() {
  [ "$(git log -1 --format=%an "$1")" = "${release_bot_name}" ] &&
    [ "$(git log -1 --format=%s "$1")" = "${release_prepare_subject}" ]
}

# A preparation commit that already sits on current main is revalidated, never regenerated.
if is_preparation_commit HEAD && git merge-base --is-ancestor "${main_sha}" HEAD^; then
  release_preparation_verify "$(git rev-parse HEAD^)" "${main_sha}"
  release_verification_dispatch "${PR_HEAD_REF}" "${PR_HEAD_SHA}" "${main_sha}"
  echo 'disposition=current' >>"${GITHUB_OUTPUT}"
  exit 0
fi

# Re-preparation drops only this workflow's own tip commit, then catches the source up with main.
if is_preparation_commit HEAD; then git reset --hard HEAD^; fi
if ! git merge-base --is-ancestor "${main_sha}" HEAD; then
  git -c user.name="${release_bot_name}" -c user.email="${release_bot_email}" \
    merge --no-ff --no-edit -m "Merge branch 'main' into ${PR_HEAD_REF}" "${main_sha}" ||
    { git merge --abort || true; fail 'release_pull_request_merge_conflict'; }
fi
source_sha="$(git rev-parse HEAD)"
if [ "${source_sha}" != "${PR_HEAD_SHA}" ]; then pnpm install --frozen-lockfile; fi
restore_native_build
plan="$(pnpm release:prepare --json)"
plan_id="$(release_plan_id "${plan}")"
release_preparation_commit "${plan_id}"
release_preparation_verify "${source_sha}" "${main_sha}"
prepared_sha="$(git rev-parse HEAD)"

# The pull request must still be open at the observed head; the lease rejects any newer push.
observed="$(gh pr view "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --json state,headRefOid \
  --jq '"\(.state) \(.headRefOid)"')"
[ "${observed}" = "OPEN ${PR_HEAD_SHA}" ] || fail 'release_pull_request_superseded'
git push --force-with-lease="refs/heads/${PR_HEAD_REF}:${PR_HEAD_SHA}" origin "HEAD:refs/heads/${PR_HEAD_REF}" ||
  fail 'release_pull_request_push_rejected'
release_verification_dispatch "${PR_HEAD_REF}" "${prepared_sha}" "${main_sha}"
echo 'disposition=prepared' >>"${GITHUB_OUTPUT}"
