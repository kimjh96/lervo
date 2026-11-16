#!/usr/bin/env bash
# Creates or reconciles the GitHub Release for one tag with exactly the verified release subjects.
# Usage: publish-github-release.sh <tag> <verified-subject-directory>
# Run from the checked-out tag; `.changes/current-release.md` supplies the notes. A new release is
# created with every asset at once; gh keeps it a draft until the uploads finish. On replay, an
# existing asset must be byte-identical and every existing asset must be a verified subject, so a
# published file is never replaced. A draft left by an interrupted creation is published only after
# every subject is attached.
set -euo pipefail
tag="${1:?tag}"
subjects="${2:?verified subject directory}"
title="@lervo/cli ${tag}"

fail() {
  echo "$1" >&2
  exit 1
}

if ! gh release view "${tag}" >/dev/null 2>&1; then
  gh release create "${tag}" --verify-tag --title "${title}" --notes-file .changes/current-release.md \
    "${subjects}"/*
  exit 0
fi

existing="$(gh release view "${tag}" --json assets --jq '.assets[].name')"
while IFS= read -r name; do
  [ -z "${name}" ] || [ -f "${subjects}/${name}" ] || fail 'release_asset_unexpected'
done <<<"${existing}"
downloads="$(mktemp -d)"
trap 'rm -rf "${downloads}"' EXIT
for file in "${subjects}"/*; do
  name="$(basename "${file}")"
  if grep -Fxq "${name}" <<<"${existing}"; then
    gh release download "${tag}" --pattern "${name}" --dir "${downloads}"
    cmp -s "${file}" "${downloads}/${name}" || fail 'release_asset_conflict'
  else
    gh release upload "${tag}" "${file}"
  fi
done
gh release edit "${tag}" --title "${title}" --notes-file .changes/current-release.md --draft=false
