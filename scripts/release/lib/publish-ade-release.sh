#!/usr/bin/env bash
# Creates or updates the GitHub Release of one ADE tag (ADR-0630).
# Usage: publish-ade-release.sh <ade-v<version>> <notes-file>
# The release carries the notes that tag prepared and no files; S3 adds signed bundles. It is never
# marked "Latest", so the CLI release stays the repository's latest, and the host follower, which
# installs only `v<version>` tags, never takes it.
set -euo pipefail
tag="${1:?tag}"
notes="${2:?notes file}"

fail() {
  echo "$1" >&2
  exit 1
}

[[ "${tag}" =~ ^ade-v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || fail 'ade_release_tag_invalid'
version="${BASH_REMATCH[1]}"
[ -f "${notes}" ] || fail 'ade_release_notes_missing'
grep -Fq "package=\"@lervo/ade\" version=\"${version}\"" "${notes}" ||
  fail 'ade_release_notes_version_mismatch'
title="@lervo/ade v${version}"

if gh release view "${tag}" >/dev/null 2>&1; then
  gh release edit "${tag}" --title "${title}" --notes-file "${notes}" --latest=false
else
  gh release create "${tag}" --verify-tag --title "${title}" --notes-file "${notes}" --latest=false
fi
