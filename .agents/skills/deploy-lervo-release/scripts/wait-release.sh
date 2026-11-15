#!/usr/bin/env bash
# Waits for one release stage and always exits: 0 success, 1 failure, 2 timeout, 3 stale.
# Usage:
#   wait-release.sh pr <number> [timeout-seconds]   PR release preparation, then verification of the
#                                                   current head, which must contain current main
#   wait-release.sh release-pr [timeout-seconds]     fallback lervo/release-cli PR and its candidate CI
#   wait-release.sh tag <version> [timeout-seconds]  tag v<version>, its CLI release matrix (any event), and the GitHub Release
# Only gh and its built-in --jq are needed, so the script behaves the same on every host.
set -u
stage="${1:?stage}"; shift
case "$stage" in pr|tag) target="${1:?target}"; shift;; *) target="";; esac
if [ "$stage" = pr ] && ! [[ "$target" =~ ^[1-9][0-9]*$ ]]; then echo "invalid PR number: $target"; exit 1; fi
deadline=$(( $(date +%s) + ${1:-2700} ))
poll="${WAIT_RELEASE_POLL_SECONDS:-30}"
last="starting"
finish() { echo "$1"; exit "$2"; }

pr_checks() {
  # gh exits non-zero when a check failed, so judge what it printed rather than its status.
  local summary total pending failed
  summary=$(gh pr checks "$1" --json name,bucket --jq '"\(length) \([.[]|select(.bucket=="pending")]|length) \([.[]|select(.bucket=="fail" or .bucket=="cancel")]|length) \([.[]|select(.bucket!="skipping")|"\(.name)=\(.bucket)"]|join(", "))"' 2>/dev/null)
  read -r total pending failed last <<<"$summary"
  [[ "${total:-}" =~ ^[0-9]+$ ]] || return 3
  [ "$total" -gt 0 ] && [ "$pending" -eq 0 ] || return 3
  [ "$failed" -eq 0 ] && return 0 || return 1
}

pr_preparation() {
  # The newest non-skipped "CLI release in pull request" run for this PR; other labels skip.
  gh run list --workflow release-pull-request.yml --limit 50 --json displayTitle,status,conclusion,createdAt \
    --jq "[.[] | select(.displayTitle == \"Prepare release in PR #$1\" and .conclusion != \"skipped\")]
      | max_by(.createdAt) | if . == null then \"none\" else \"\(.status)/\(.conclusion)\" end" 2>/dev/null
}

pr_fresh() {
  # Main reuses PR verification only when the merged tree equals the PR head tree. The caller
  # passes the head it observed so freshness and verification judge the same commit.
  local base status
  base=$(gh pr view "$1" --json baseRefName --jq .baseRefName 2>/dev/null) || return 3
  status=$(gh api "repos/{owner}/{repo}/compare/$base...$2" --jq .status 2>/dev/null) || return 3
  case "$status" in ahead|identical) return 0;; behind|diverged) return 1;; *) return 3;; esac
}

pr_prepared() {
  # The release-in-pull-request workflow's own commit; its verification is a dispatched run.
  local who; who=$(gh api "repos/{owner}/{repo}/commits/$1" \
    --jq '"\(.commit.author.name)|\(.commit.message | split("\n")[0])"' 2>/dev/null) || return 3
  [ "$who" = "lervo-release[bot]|chore(cli): prepare release" ]
}

pr_dispatched() {
  # Dispatched runs are not pull-request checks: judge the newest Code quality dispatch for this
  # exact head, never one for an older commit. 0 passed, 1 failed, 3 pending, 4 none exists.
  local sha="$1" run id status conclusion aggregate
  run=$(gh run list --workflow code-quality.yml --commit "$sha" --event workflow_dispatch \
    --json databaseId,headSha,status,conclusion,createdAt \
    --jq "[.[] | select(.headSha == \"$sha\")] | max_by(.createdAt)
      | if . == null then \"none\" else \"\(.databaseId) \(.status) \(.conclusion)\" end" 2>/dev/null) || return 3
  [ "$run" = none ] && return 4
  read -r id status conclusion <<<"$run"
  [[ "${id:-}" =~ ^[0-9]+$ ]] || return 3
  last="Code quality run $id for $sha: $status/${conclusion:-}"
  [ "$status" = completed ] || return 3
  [ "$conclusion" = success ] || return 1
  aggregate=$(gh run view "$id" --json jobs \
    --jq '[.jobs[] | select(.name == "CI verification (lervo-ci-v1)" and .conclusion == "success")] | length' 2>/dev/null) || return 3
  [ "${aggregate:-0}" -gt 0 ] && return 0 || return 1
}

pr_verified() {
  # A dispatch for the exact head decides; a prepared head waits for one; otherwise PR checks decide.
  local head="$2" code
  pr_dispatched "$head"; code=$?
  [ $code -ne 4 ] && return $code
  pr_prepared "$head"; code=$?
  case $code in
    0) last="prepared head $head: waiting for its dispatched Code quality run"; return 3;;
    1) pr_checks "$1"; return $?;;
    *) last="head $head author unknown"; return 3;;
  esac
}

# Judge the stage at least once, so a timeout always reports an observed state, even when the
# whole-second deadline has already passed by the time the loop starts.
judged=""
while [ -z "$judged" ] || [ "$(date +%s)" -lt "$deadline" ]; do
  judged=1
  case "$stage" in
    pr)
      prep=$(pr_preparation "$target") || prep="unknown"
      case "$prep" in
        completed/success|none) ;;
        completed/*) finish "PR #$target release preparation failed: $prep" 1;;
        *) last="release preparation ${prep:-unknown}"; sleep "$poll"; continue;;
      esac
      head=$(gh pr view "$target" --json headRefOid --jq .headRefOid 2>/dev/null)
      [[ "$head" =~ ^[a-f0-9]{40}$ ]] || { last="head unknown"; sleep "$poll"; continue; }
      pr_fresh "$target" "$head"; code=$?
      [ $code -eq 1 ] && finish "PR #$target head does not contain current main: run 'gh pr update-branch $target', or rerun its release preparation if it is prepared, then wait again" 3
      [ $code -eq 3 ] && { last="freshness unknown"; sleep "$poll"; continue; }
      pr_verified "$target" "$head"; code=$?
      # A head that moved during the checks was not the one judged: judge the new head next round.
      now=$(gh pr view "$target" --json headRefOid --jq .headRefOid 2>/dev/null)
      [ "$now" = "$head" ] || { last="head moved from $head to ${now:-unknown}"; sleep "$poll"; continue; }
      [ $code -eq 0 ] && finish "PR #$target passed at $head (merge with: gh pr merge $target --merge --match-head-commit $head): $last" 0
      [ $code -eq 1 ] && finish "PR #$target failed: $last" 1
      ;;
    release-pr)
      number=$(gh pr list --head lervo/release-cli --state open --json number --jq '.[0].number // empty' 2>/dev/null)
      if [ -n "$number" ]; then
        sha=$(gh pr view "$number" --json headRefOid --jq .headRefOid)
        # Only the newest dispatch of each workflow counts; a retried candidate supersedes a failure.
        summary=$(gh run list --commit "$sha" --event workflow_dispatch --json name,status,conclusion,createdAt \
          --jq '[group_by(.name)[] | max_by(.createdAt)]
            | "\(length) \([.[]|select(.status!="completed")]|length) \([.[]|select(.conclusion!="success")]|length) \([.[]|"\(.name)=\(.status)/\(.conclusion)"]|join(", "))"' 2>/dev/null)
        read -r total pending bad runs <<<"${summary:-0 0 0}"
        last="PR #$number $sha: ${runs:-}"
        if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
          [ "$bad" -eq 0 ] && finish "candidate passed: $last" 0 || finish "candidate failed: $last" 1
        fi
      else
        prep=$(gh run list --workflow "CLI release preparation" --limit 1 --json status,conclusion --jq '.[0]|"\(.status)/\(.conclusion)"' 2>/dev/null)
        last="no release PR yet; preparation $prep"
        case "$prep" in completed/failure|completed/cancelled) finish "preparation failed: $prep" 1;; esac
      fi
      ;;
    tag)
      tag="v$target"
      if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
        run=$(gh run list --workflow "CLI release matrix" --branch "$tag" --limit 1 --json status,conclusion --jq '.[0]|"\(.status)/\(.conclusion)"' 2>/dev/null)
        last="$tag matrix $run"
        case "$run" in
          completed/success)
            draft=$(gh release view "$tag" --json isDraft --jq .isDraft 2>/dev/null)
            [ "$draft" = "false" ] && finish "$tag released: matrix success, release published" 0
            last="$tag matrix success; release draft=$draft";;
          completed/*) finish "$tag matrix failed: $run" 1;;
        esac
      else
        last="$tag not pushed yet"
      fi
      ;;
    *) finish "unknown stage: $stage" 1;;
  esac
  sleep "$poll"
done
finish "TIMEOUT $stage $target: $last" 2
