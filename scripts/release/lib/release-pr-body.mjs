const managedStart = "<!-- lervo:begin block=release_pr_body schema=1 -->";
const managedEnd = "<!-- lervo:end block=release_pr_body -->";

export function renderReleasePrBody({
  repository,
  sourceRevision,
  releaseRevision,
  planId,
  runId,
  existingBody,
}) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
    ![sourceRevision, releaseRevision].every((value) => /^[a-f0-9]{40}$/u.test(value)) ||
    !/^relprep_[a-f0-9]{24}$/u.test(planId) ||
    !/^\d+$/u.test(String(runId))
  )
    throw new Error("release_pr_coordinates_invalid");
  const generated = `## Summary

${managedStart}

Prepare the reviewed \`@lervo/cli\` version and current release notes from plan \`${planId}\` at commit \`${releaseRevision}\`.

## Scope and authority

The checked diff against \`${sourceRevision}\` contains only the CLI version, lockfile, current release note, release manifest, SBOM, and consumed intent. Generation grants no npm staging or publication authority. The workflow cannot attest that an agent read \`AGENTS.md\`.

## Contract and architecture

Version-bound files retain their existing generators. N/A: The allowed diff contains no source module requiring a split.

## Release impact

The consumed intent and exact plan \`${planId}\` bind the version decision. This PR prepares a version and does not authorize npm publication.

## Verification

Base-bound release completion and the changed-path check passed in [generation run ${runId}](https://github.com/${repository}/actions/runs/${runId}). Full tests, quality checks, knowledge lint, and distribution verification are pending in the explicitly dispatched CI for [exact candidate ${releaseRevision}](https://github.com/${repository}/commit/${releaseRevision}/checks). Source-main CI does not establish candidate success. The verification checklist remains open until those results are observed.

## Knowledge and documentation

The generated current release note is the documentation changed here. N/A: Generated-only release aggregation changes no repository-wide knowledge lifecycle source or roadmap criteria. Source documentation and roadmap evidence remain the responsibility of the aggregated source changes.

## Risk and recovery

The fixed branch ref uses an exact predecessor lease. Superseded main, changed intent, a failed generator, or a concurrent ref change stops the write. Reruns verify or regenerate the bounded candidate; tags retain their separate exact-CI gate. No dedicated secret scan ran, so that checklist item remains open.

## Checklist

- [ ] I read \`AGENTS.md\` and the relevant linked entrypoints before changing bytes.
- [x] I reviewed every touched source against \`docs/foundation/code-convention.md\`. N/A: No source module changed.
- [x] Repository-authored state is bounded; this change adds neither an append-only file nor a one-file-per-operation archive.
- [x] Lervo-managed, generated, and user-owned bytes retain distinct owners.
- [x] Affected documentation and roadmap completion criteria are current. N/A: Only the generated release note changes.
- [ ] Relevant tests, \`pnpm quality:check\`, and required Lervo migration/lint checks pass. Exact candidate CI is pending.
- [ ] No secret, mutable credential, or unsupported authority is included.

${managedEnd}
`;
  if (existingBody === undefined) return generated;
  if (
    typeof existingBody !== "string" ||
    Buffer.byteLength(existingBody) > 64 * 1024 ||
    existingBody.split(managedStart).length !== 2 ||
    existingBody.split(managedEnd).length !== 2
  )
    throw new Error("release_pr_body_ownership_unknown");
  const start = existingBody.indexOf(managedStart);
  const end = existingBody.indexOf(managedEnd);
  if (end <= start) throw new Error("release_pr_body_ownership_unknown");
  return `${existingBody.slice(0, start)}${generated.slice(generated.indexOf(managedStart), generated.indexOf(managedEnd) + managedEnd.length)}${existingBody.slice(end + managedEnd.length)}`;
}
