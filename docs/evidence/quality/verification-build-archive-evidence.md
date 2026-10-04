# Verification build archive implementation evidence

This document records the supplied implementation of `scripts/distribution/lib/verification-build-cache.mjs`, its preparation runner, and test fixtures. It qualifies the shared-build decision in [ADR-0450](../../decisions/knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md) and supplements [ADR-0357](../../decisions/execution/verification/0357-prepare-isolated-candidate-verification-workspaces.md). Source inspection establishes behavior and fixture scope; these sources include no test execution or installed acceptance receipt.

## Input and local reuse boundary

Git enumerates tracked and untracked nonignored paths. The digest excludes `.md` and `.tsbuildinfo` suffixes and paths below `docs/`, `.lervo/`, and `.changes/`. It binds the Node process version and sorted, deduplicated path/content hashes. Symlinks contribute link text, not target contents. Paths missing during reading are skipped; other read errors propagate. Ignored dependencies and build artifacts are not independently inventoried.

Local reuse requires a matching marker input digest and existence of the requested CLI, Node, and Hub `dist/bin.js` paths. The marker reader validates neither schema version nor output contents. These checks establish neither build determinism nor the irrelevance of every excluded input.

## Shared archive creation and retention

The helper resolves Git's absolute common directory and stores archives below `lervo-verification-builds`. Each filename is the input digest without its `sha256:` prefix, followed by `.tar`.

Archive selection includes existing `dist` paths beneath immediate children of `apps` and `packages`. It neither independently validates them as directories nor establishes output-set completeness. If no paths are selected, creation returns without an archive.

Creation runs `tar -cf` into a PID-suffixed temporary path, then renames it to the digest-named target. It sorts `.tar` files by filesystem modification time and removes all but two. Retention therefore uses archive modification time, not last successful reuse. The helper has no archive-operation lock or explicit temporary-file cleanup on failure.

## Restore and preparation order

The runner inspects `.git`. If it is a file, offline frozen installation runs before reuse assessment with a 300,000-millisecond child timeout. Missing `.git` fails inspection. Preparation then proceeds:

1. Reuse a matching local marker if all three requested outputs exist.
2. Otherwise, attempt the archive named by the current input digest. After extraction and successful output-existence checks, record the local marker.
3. If restoration returns false, run `pnpm build` with a 1,200,000-millisecond child timeout. After successful exit, record the marker, then archive outputs.

A missing digest-named archive returns false. An existing archive is extracted directly into the checkout with `tar -xf`, followed only by required-path existence checks. The helper does not validate archive members, embedded input coordinates, or output hashes before extraction. Existing output paths can satisfy the post-extraction check. There is no staging directory or rollback of partially extracted bytes.

ADR-0450's fallback statement is narrower in this implementation: missing archives and false post-extraction existence checks reach an ordinary build; extraction errors propagate. Archive creation and pruning errors also propagate, potentially after a successful build marker is recorded. The helper's archive Git and tar calls have no explicit child timeout; the runner's install and build limits do not cover them.

## Fixture scope and remaining evidence

The supplied tests define checks for source and lockfile inclusion, documentation and private-state exclusion, missing-marker rejection, reuse after a documentation edit, missing-output rejection, and invalidation after a source edit.

The archive fixture creates and archives a package output, creates a detached sibling worktree, and confirms matching digests after a documentation edit. It checks that restoration returns true for the matching digest and false after a source edit, but does not compare restored contents.

No supplied fixture establishes corrupt-archive handling, member-path safety, output tampering detection, two-archive pruning, concurrent archive operations, partial-extraction recovery, or archive subprocess deadlines. These are test definitions, not passing execution results.

ADR-0450 also requires reviewed-output commits, preservation of developer changes, a stage-owned child-commit fence, and post-commit currency. Their implementation is outside the supplied cache sources. Successful cache reuse or restoration would establish neither those behaviors, a passing isolated suite, nor the installed clean-working-tree acceptance condition.
