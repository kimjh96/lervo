# Output selection and Git mutation

The commit helper requires a symbolic branch and refuses observed merge, cherry-pick, revert, rebase, bisect, or index-lock markers. Under [ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), it also refuses unless the private ownership fence grants this host a current `owner` verdict. Refusal returns an empty result and leaves working-tree bytes in place. The freshness commit requires the same grant. Owner commits add the trailer `Lervo-Convergence-Host: <hostHash>`.

The helper reads porcelain status, including untracked files, and selects:

- Present integrated draft bytes whose recorded preimage equals the current HEAD blob hash, including null for an absent path.
- Dirty present records and reviewed rewrite paths from current normalization records whose source hash matches HEAD or an integrated draft over that HEAD preimage.
- Deleted normalization source paths admitted by those records.
- Deleted superseded normalization records whose committed source path has an admitted replacement record.

Selection is sorted. Rename and copy parsing consumes the original-path status field without independently adding that path. The selector relies on normalization inspection to establish current reviewed outputs.

## Formatting before the commit

When the repository depends on Prettier, the helper loads it from the repository root and formats using the repository's configuration and `.prettierignore` before staging. It never writes formatter configuration. Formatting follows selection because selection matches reviewed bytes by hash. Formatting applies to:

- Every selected present path that no lifecycle owns after the commit.
- Every path a selected record change releases from lifecycle ownership, because it becomes the formatter's at this commit. Released paths with uncommitted edits remain untouched for their developer.

Post-commit lifecycle ownership comes from normalization record outputs and managed or generated documents in the document ownership registry, mirroring `scripts/quality/lib/format-ownership.mjs`. Those outputs and the ownership sources themselves retain their reviewed bytes.

Formatted paths join the commit pathspec. The stage receipt records each formatting change as an approved effect with before and after hashes, allowing the source fence to accept it. If the commit fails, the helper restores the replaced bytes, and the next cycle selects the reviewed bytes again. Repositories without Prettier commit reviewed bytes unchanged.

## Staging and commit

The helper stages selected paths with `git add -A --`, then uses `git commit --only` with:

- Subject: `docs: apply reviewed background knowledge`.
- Body: the obligation ID.
- Author and committer: `Lervo Knowledge <knowledge@lervo.invalid>`.

The commit does not depend on a developer or runner Git identity. Without an explicit committer, Git refuses commits on hosts without a configured or derivable identity, such as CI runners. Other paths are omitted from the commit pathspec.

After success, the helper reads HEAD and its first parent. It returns committed paths and before/after coordinates only if that parent equals the observed pre-commit HEAD.

## Failure and concurrency limits

The inspected source does not establish an atomic selection-to-commit boundary. Safety markers are inspected before selection; the helper does not rehash selected content immediately before Git mutation. `headBlob` returns null for every caught Git read failure, not only confirmed path absence.

Staging or commit failure returns an empty result with null HEAD coordinates, without explicit rollback of staging changes. Earlier inspection or selection errors can propagate. A post-commit parent mismatch also returns an empty result without undoing the commit. A null result therefore does not prove that Git or index bytes were unchanged.

Outer serialization, recovery, and authority require separate verification before claiming protection against concurrent developer edits or uncertain effects.
