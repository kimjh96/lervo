#!/usr/bin/env bash
# Waits for one release stage and always exits: 0 success, 1 failure, 2 timeout, 3 stale.
# Usage:
#   wait-release.sh pr <number> [timeout-seconds]   PR release preparation, then the PR head checks
#                                                   on a head that contains current main
#   wait-release.sh release-pr [timeout-seconds]     fallback lervo/release-cli PR and its candidate CI
#   wait-release.sh tag <version> [timeout-seconds]  tag v<version>, its CLI release matrix (any event), and the GitHub Release
set -u
stage="${1:?stage}"; shift
case "$stage" in pr|tag) target="${1:?target}"; shift;; *) target="";; esac
deadline=$(( $(date +%s) + ${1:-2700} ))
last="starting"
finish() { echo "$1"; exit "$2"; }

pr_checks() {
  # gh exits non-zero when a check failed, so judge the JSON it printed rather than its status.
  local json; json=$(gh pr checks "$1" --json name,bucket 2>/dev/null)
  jq -e 'type == "array"' >/dev/null 2>&1 <<<"$json" || return 3
  local pending total failed
  total=$(jq 'length' <<<"$json"); pending=$(jq '[.[]|select(.bucket=="pending")]|length' <<<"$json")
  failed=$(jq '[.[]|select(.bucket=="fail" or .bucket=="cancel")]|length' <<<"$json")
  last=$(jq -r '[.[]|select(.bucket!="skipping")|"\(.name)=\(.bucket)"]|join(", ")' <<<"$json")
  [ "$total" -gt 0 ] && [ "$pending" -eq 0 ] || return 3
  [ "$failed" -eq 0 ] && return 0 || return 1
}

pr_preparation() {
  # The newest non-skipped "CLI release in pull request" run for this PR; other labels skip.
  local runs; runs=$(gh run list --workflow release-pull-request.yml --limit 50 \
    --json displayTitle,status,conclusion,createdAt 2>/dev/null) || return 3
  jq -r --arg title "Prepare release in PR #$1" '[.[] | select(.displayTitle == $title and .conclusion != "skipped")]
    | max_by(.createdAt) | if . == null then "none" else "\(.status)/\(.conclusion)" end' <<<"$runs"
}

pr_fresh() {
  # Main reuses PR verification only when the merged tree equals the PR head tree.
  local json head base status
  json=$(gh pr view "$1" --json headRefOid,baseRefName 2>/dev/null) || return 3
  head=$(jq -r .headRefOid <<<"$json"); base=$(jq -r .baseRefName <<<"$json")
  status=$(gh api "repos/{owner}/{repo}/compare/$base...$head" --jq .status 2>/dev/null) || return 3
  case "$status" in ahead|identical) return 0;; behind|diverged) return 1;; *) return 3;; esac
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  case "$stage" in
    pr)
      prep=$(pr_preparation "$target") || prep="unknown"
      case "$prep" in
        completed/success|none) ;;
        completed/*) finish "PR #$target release preparation failed: $prep" 1;;
        *) last="release preparation $prep"; sleep 30; continue;;
      esac
      pr_fresh "$target"; code=$?
      [ $code -eq 1 ] && finish "PR #$target head does not contain current main: run 'gh pr update-branch $target', or rerun its release preparation if it is prepared, then wait again" 3
      [ $code -eq 3 ] && { last="freshness unknown"; sleep 30; continue; }
      pr_checks "$target"; code=$?
      [ $code -eq 0 ] && finish "PR #$target passed: $last" 0
      [ $code -eq 1 ] && finish "PR #$target failed: $last" 1
      ;;
    release-pr)
      number=$(gh pr list --head lervo/release-cli --state open --json number --jq '.[0].number' 2>/dev/null)
      if [ -n "$number" ]; then
        sha=$(gh pr view "$number" --json headRefOid --jq .headRefOid)
        # Only the newest dispatch of each workflow counts; a retried candidate supersedes a failure.
        runs=$(gh run list --commit "$sha" --event workflow_dispatch --json name,status,conclusion,createdAt 2>/dev/null \
          | jq '[group_by(.name)[] | max_by(.createdAt)]' 2>/dev/null || echo '[]')
        total=$(jq 'length' <<<"$runs"); pending=$(jq '[.[]|select(.status!="completed")]|length' <<<"$runs")
        last="PR #$number $sha: $(jq -r '[.[]|"\(.name)=\(.status)/\(.conclusion)"]|join(", ")' <<<"$runs")"
        if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
          bad=$(jq '[.[]|select(.conclusion!="success")]|length' <<<"$runs")
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
  sleep 30
done
finish "TIMEOUT $stage $target: $last" 2
