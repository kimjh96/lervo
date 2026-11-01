#!/usr/bin/env bash
# Waits for one release stage and always exits: 0 success, 1 failure, 2 timeout.
# Usage:
#   wait-release.sh pr <number> [timeout-seconds]   feature or release PR checks
#   wait-release.sh release-pr [timeout-seconds]     lervo/release-cli PR and its dispatched candidate CI
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

while [ "$(date +%s)" -lt "$deadline" ]; do
  case "$stage" in
    pr)
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
