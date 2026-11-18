#!/usr/bin/env bash
# Waits for one release stage and always exits: 0 success, 1 failure, 2 timeout, 3 stale.
# Usage:
#   wait-release.sh pr <number> [timeout-seconds]   PR release preparation, then verification of the
#                                                   current head, which must contain current main
#   wait-release.sh release-pr [timeout-seconds]     fallback lervo/release-cli PR and its candidate CI
#   wait-release.sh tag <version> [timeout-seconds]  tag v<version>, its CLI release matrix (any event), and the GitHub Release
#                                                   with its verified release subjects attached; a matrix
#                                                   whose jobs GitHub cancelled before any runner took
#                                                   them is rerun up to WAIT_RELEASE_RERUNS (default 3) times
# Every stage is judged at least once, so a timeout of 0 judges it exactly once.
# A gh or git query that fails is reported as unavailable, never read as an empty answer: the round
# concludes nothing, repeated failures print `gh_unavailable: <first stderr line>` to stderr and back
# off up to 8 poll intervals, and a timeout names a failure of its last round.
# Only gh with its built-in --jq and, for the pr and tag stages, `git ls-remote origin` are needed,
# so the script behaves the same on every host. Run it from the repository directory.
set -u
stage="${1:?stage}"; shift
case "$stage" in pr|tag) target="${1:?target}"; shift;; *) target="";; esac
if [ "$stage" = pr ] && ! [[ "$target" =~ ^[1-9][0-9]*$ ]]; then echo "invalid PR number: $target"; exit 1; fi
deadline=$(( $(date +%s) + ${1:-2700} ))
poll="${WAIT_RELEASE_POLL_SECONDS:-30}"
last="starting"
reruns=0
failures=0
failure=""
# Queries run in command substitutions, so they report failures through a file the loop reads.
round_errors=$(mktemp) || { echo "cannot create a temporary file"; exit 1; }
trap 'rm -f "$round_errors" "$round_errors.stderr"' EXIT
finish() {
  if [ "$2" -eq 2 ] && [ -n "$failure" ]; then echo "$1; last query failure: $failure"; else echo "$1"; fi
  exit "$2"
}

unavailable() {
  # Records why a query failed: label, exit status, and the stderr file it wrote.
  local line; line=$(head -n 1 "$3" 2>/dev/null)
  printf '%s: %s\n' "$1" "${line:-exited $2}" >"$round_errors"
}

gh_query() {
  # Prints gh's answer, or records the failure and returns non-zero. With --output-decides, any
  # printed answer counts, because gh pr checks exits non-zero when a check failed or is pending.
  local decides="" out status
  [ "$1" = --output-decides ] && { decides=1; shift; }
  out=$(gh "$@" 2>"$round_errors.stderr"); status=$?
  if [ $status -ne 0 ] && { [ -z "$decides" ] || [ -z "$out" ]; }; then
    # gh pr checks reports a head without any check this way; that is an empty answer.
    if [ -n "$decides" ] && grep -q '^no checks reported' "$round_errors.stderr"; then return 1; fi
    unavailable gh_unavailable "$status" "$round_errors.stderr"
    return 1
  fi
  printf '%s\n' "$out"
}

pause() {
  # Ends a round. A round with a failed query backs off and, from the second one in a row, says why.
  local factor=1 i
  if [ -s "$round_errors" ]; then
    failure=$(head -n 1 "$round_errors"); : >"$round_errors"
    failures=$((failures + 1))
    factor=$(( failures >= 4 ? 8 : 1 << (failures - 1) ))
    [ "$failures" -ge 2 ] && echo "$stage${target:+ $target}: $failure ($failures rounds in a row; next poll in ${factor}x${poll}s)" >&2
  else
    # A recovered query no longer explains the state, so a timeout does not report it.
    failures=0
    failure=""
  fi
  for ((i = 0; i < factor; i++)); do
    [ "$(date +%s)" -lt "$deadline" ] || break
    sleep "$poll"
  done
}

never_started() {
  # GitHub cancels a job that waited about 15 minutes for a runner. Such a job has no runner and no
  # steps, which says nothing about the release, so it is rerun instead of judged. 0 when every
  # cancelled job of the run never started, 2 when the jobs could not be read.
  local counts cancelled unassigned
  counts=$(gh_query api "repos/{owner}/{repo}/actions/runs/$1/jobs?per_page=100" \
    --jq '[.jobs[] | select(.conclusion == "cancelled")] | "\(length) \([.[] | select((.runner_name // "") == "" and (.steps | length) == 0)] | length)"') || return 2
  read -r cancelled unassigned <<<"$counts"
  [[ "${cancelled:-}" =~ ^[1-9][0-9]*$ ]] && [ "$cancelled" = "${unassigned:-}" ]
}

pr_checks() {
  # gh exits non-zero when a check failed, so judge what it printed rather than its status.
  local summary total pending failed
  summary=$(gh_query --output-decides pr checks "$1" --json name,bucket --jq '"\(length) \([.[]|select(.bucket=="pending")]|length) \([.[]|select(.bucket=="fail" or .bucket=="cancel")]|length) \([.[]|select(.bucket!="skipping")|"\(.name)=\(.bucket)"]|join(", "))"')
  read -r total pending failed last <<<"$summary"
  [[ "${total:-}" =~ ^[0-9]+$ ]] || return 3
  [ "$total" -gt 0 ] && [ "$pending" -eq 0 ] || return 3
  [ "$failed" -eq 0 ] && return 0 || return 1
}

pr_preparation() {
  # The newest non-skipped "CLI release in pull request" run for this PR; other labels skip.
  gh_query run list --workflow release-pull-request.yml --limit 50 --json displayTitle,status,conclusion,createdAt \
    --jq "[.[] | select(.displayTitle == \"Prepare release in PR #$1\" and .conclusion != \"skipped\")]
      | max_by(.createdAt) | if . == null then \"none\" else \"\(.status)/\(.conclusion)\" end"
}

pr_fresh() {
  # Main reuses PR verification only when the merged tree equals the PR head tree. A head on
  # current main also ran the exact release metadata check that main runs after a release merge
  # (ADR-0572). The caller passes the head it observed so freshness and verification judge the
  # same commit.
  local base status
  base=$(gh_query pr view "$1" --json baseRefName --jq .baseRefName) || return 3
  status=$(gh_query api "repos/{owner}/{repo}/compare/$base...$2" --jq .status) || return 3
  case "$status" in ahead|identical) return 0;; behind|diverged) return 1;; *) return 3;; esac
}

pr_prepared() {
  # The release-in-pull-request workflow's own commit; its verification is a dispatched run.
  local who; who=$(gh_query api "repos/{owner}/{repo}/commits/$1" \
    --jq '"\(.commit.author.name)|\(.commit.message | split("\n")[0])"') || return 3
  [ "$who" = "lervo-release[bot]|chore(cli): prepare release" ]
}

pr_dispatched() {
  # Dispatched runs are not pull-request checks: judge the newest Code quality dispatch for this
  # exact head, never one for an older commit. 0 passed, 1 failed, 3 pending, 4 none exists.
  local sha="$1" run id status conclusion aggregate
  run=$(gh_query run list --workflow code-quality.yml --commit "$sha" --event workflow_dispatch \
    --json databaseId,headSha,status,conclusion,createdAt \
    --jq "[.[] | select(.headSha == \"$sha\")] | max_by(.createdAt)
      | if . == null then \"none\" else \"\(.databaseId) \(.status) \(.conclusion)\" end") || return 3
  [ "$run" = none ] && return 4
  read -r id status conclusion <<<"$run"
  [[ "${id:-}" =~ ^[0-9]+$ ]] || return 3
  last="Code quality run $id for $sha: $status/${conclusion:-}"
  [ "$status" = completed ] || return 3
  [ "$conclusion" = success ] || return 1
  aggregate=$(gh_query run view "$id" --json jobs \
    --jq '[.jobs[] | select(.name == "CI verification (lervo-ci-v1)" and .conclusion == "success")] | length') || return 3
  [ "${aggregate:-0}" -gt 0 ] && return 0 || return 1
}

pr_matrix() {
  # A prepared head also needs its own dispatched CLI release matrix, because the tag publishes the
  # release subjects that run verified. 0 passed, 1 failed, 3 pending or not dispatched yet.
  local sha="$1" run id status conclusion
  run=$(gh_query run list --workflow cli-release-matrix.yml --commit "$sha" --event workflow_dispatch \
    --json databaseId,headSha,status,conclusion,createdAt \
    --jq "[.[] | select(.headSha == \"$sha\")] | max_by(.createdAt)
      | if . == null then \"none\" else \"\(.databaseId) \(.status) \(.conclusion)\" end") || return 3
  # A head prepared before preparation dispatched the matrix never gets one by waiting.
  if [ "$run" = none ]; then
    last="$last; waiting for its dispatched CLI release matrix run; if none starts, rerun release preparation (gh workflow run release-pull-request.yml -f pull_request=$target), which dispatches the missing matrix without a new commit"
    return 3
  fi
  read -r id status conclusion <<<"$run"
  [[ "${id:-}" =~ ^[0-9]+$ ]] || return 3
  last="$last; CLI release matrix run $id: $status/${conclusion:-}"
  [ "$status" = completed ] || return 3
  [ "$conclusion" = success ] && return 0 || return 1
}

main_released() {
  # An unprepared pull request verifies release metadata in generated mode even while main's CLI
  # version is untagged (ADR-0588), but main checks it exactly until the tag exists. A merge in that
  # window could fail main and block the tag, so a passed head waits for the tag. 0 tagged, 3 not
  # yet or unknown.
  local base version code
  base=$(gh_query pr view "$1" --json baseRefName --jq .baseRefName) || return 3
  version=$(gh_query api "repos/{owner}/{repo}/contents/apps/cli/package.json?ref=$base" \
    --jq '.content | gsub("\n"; "") | @base64d | fromjson | .version') || return 3
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { last="$last; $base CLI version unknown"; return 3; }
  git ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>"$round_errors.stderr"; code=$?
  case $code in
    0) return 0;;
    2) last="$last; waiting for v$version, the release on $base, before a merge; if that release is abandoned, rerun release preparation (gh workflow run release-preparation.yml) or decide to merge from the GitHub interface";;
    *) unavailable git_unavailable "$code" "$round_errors.stderr"; last="$last; v$version on origin unknown";;
  esac
  return 3
}

pr_verified() {
  # A dispatch for the exact head decides; a prepared head waits for one and for its release matrix;
  # otherwise PR checks decide, and a passed unprepared head also waits for main's release tag.
  local head="$2" code matrix
  pr_dispatched "$head"; code=$?
  if [ $code -eq 4 ]; then
    pr_prepared "$head"; code=$?
    case $code in
      0) last="prepared head $head: waiting for its dispatched Code quality run"; return 3;;
      1) pr_checks "$1"; code=$?; [ $code -eq 0 ] && { main_released "$1"; return $?; }; return $code;;
      *) last="head $head author unknown"; return 3;;
    esac
  fi
  pr_prepared "$head"
  case $? in
    0) ;;
    1) [ $code -eq 0 ] && { main_released "$1"; return $?; }; return $code;;
    *) last="head $head author unknown"; return 3;;
  esac
  pr_matrix "$head"; matrix=$?
  if [ $code -eq 1 ] || [ $matrix -eq 1 ]; then return 1; fi
  if [ $code -eq 0 ] && [ $matrix -eq 0 ]; then return 0; fi
  return 3
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
        *) last="release preparation ${prep:-unknown}"; pause; continue;;
      esac
      head=$(gh_query pr view "$target" --json headRefOid --jq .headRefOid)
      [[ "$head" =~ ^[a-f0-9]{40}$ ]] || { last="head unknown"; pause; continue; }
      pr_fresh "$target" "$head"; code=$?
      [ $code -eq 1 ] && finish "PR #$target head does not contain current main: run 'gh pr update-branch $target', or rerun its release preparation if it is prepared, then wait again" 3
      [ $code -eq 3 ] && { last="freshness unknown"; pause; continue; }
      pr_verified "$target" "$head"; code=$?
      # A head that moved during the checks was not the one judged: judge the new head next round.
      now=$(gh_query pr view "$target" --json headRefOid --jq .headRefOid)
      [ "$now" = "$head" ] || { last="head moved from $head to ${now:-unknown}"; pause; continue; }
      [ $code -eq 0 ] && finish "PR #$target passed at $head (merge with: gh pr merge $target --merge --match-head-commit $head): $last" 0
      [ $code -eq 1 ] && finish "PR #$target failed: $last" 1
      ;;
    release-pr)
      # A failed query concludes nothing: an unreadable list is not "no release PR yet".
      number=$(gh_query pr list --head lervo/release-cli --state open --json number --jq '.[0].number // empty') \
        || { pause; continue; }
      if [ -n "$number" ]; then
        sha=$(gh_query pr view "$number" --json headRefOid --jq .headRefOid) || { pause; continue; }
        # Only the newest dispatch of each workflow counts; a retried candidate supersedes a failure.
        summary=$(gh_query run list --commit "$sha" --event workflow_dispatch --json name,status,conclusion,createdAt \
          --jq '[group_by(.name)[] | max_by(.createdAt)]
            | "\(length) \([.[]|select(.status!="completed")]|length) \([.[]|select(.conclusion!="success")]|length) \([.[]|"\(.name)=\(.status)/\(.conclusion)"]|join(", "))"') \
          || { last="PR #$number $sha: runs unknown"; pause; continue; }
        read -r total pending bad runs <<<"${summary:-0 0 0}"
        last="PR #$number $sha: ${runs:-}"
        if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
          [ "$bad" -eq 0 ] && finish "candidate passed: $last" 0 || finish "candidate failed: $last" 1
        fi
      else
        prep=$(gh_query run list --workflow "CLI release preparation" --limit 1 --json status,conclusion --jq '.[0]|"\(.status)/\(.conclusion)"') \
          || { pause; continue; }
        last="no release PR yet; preparation $prep"
        case "$prep" in completed/failure|completed/cancelled) finish "preparation failed: $prep" 1;; esac
      fi
      ;;
    tag)
      tag="v$target"
      # ls-remote --exit-code exits 2 only when origin answered without the tag.
      git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>"$round_errors.stderr"; code=$?
      if [ $code -eq 0 ]; then
        matrix=$(gh_query run list --workflow "CLI release matrix" --branch "$tag" --limit 1 --json status,conclusion,databaseId --jq '.[0]|"\(.status)/\(.conclusion) \(.databaseId)"') \
          || { pause; continue; }
        read -r run run_id <<<"$matrix"
        last="$tag matrix $run"
        case "$run" in
          completed/success)
            # The release counts only once every verified subject is attached, so hosts can fetch it.
            release=$(gh_query release view "$tag" --json isDraft,assets \
              --jq '"\(.isDraft) \([.assets[].name] | sort | join(","))"') || { pause; continue; }
            expected="false lervo-cli-$target.tgz,release-artifact-manifest.json,release-sbom.cdx.json,release-subjects.json"
            [ "$release" = "$expected" ] && finish "$tag released: matrix success, release published with verified subjects" 0
            last="$tag matrix success; release draft and assets: ${release:-unknown}";;
          completed/cancelled)
            started=1
            if [ "$reruns" -lt "${WAIT_RELEASE_RERUNS:-3}" ] && [[ "${run_id:-}" =~ ^[0-9]+$ ]]; then
              never_started "$run_id"; started=$?
            fi
            case $started in
              0)
                gh run rerun "$run_id" --failed >/dev/null 2>&1 || finish "$tag matrix run $run_id: rerun failed" 1
                reruns=$((reruns + 1))
                last="$tag matrix run $run_id cancelled before any runner took its jobs; rerun $reruns";;
              2) last="$tag matrix run $run_id cancelled; its jobs could not be read";;
              *) finish "$tag matrix failed: $run" 1;;
            esac;;
          completed/*) finish "$tag matrix failed: $run" 1;;
        esac
      elif [ $code -eq 2 ]; then
        last="$tag not pushed yet"
      else
        unavailable git_unavailable "$code" "$round_errors.stderr"
        last="$tag on origin unknown"
      fi
      ;;
    *) finish "unknown stage: $stage" 1;;
  esac
  pause
done
finish "TIMEOUT $stage $target: $last" 2
