#!/usr/bin/env bash
# Fails unless every verified release subject is byte-identical to the file attested-cli signed.
# Usage: compare-attested-subjects.sh <verified-subject-directory> <attested-release-directory>
set -euo pipefail
subjects="${1:?verified subject directory}"
attested="${2:?attested release directory}"
for file in "${subjects}"/*; do
  name="$(basename "${file}")"
  [ "${name}" = release-subjects.json ] && continue
  if ! cmp -s "${file}" "${attested}/${name}"; then
    echo 'release_subjects_attestation_mismatch' >&2
    exit 1
  fi
done
