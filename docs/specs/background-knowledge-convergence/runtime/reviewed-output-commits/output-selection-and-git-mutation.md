# Output selection and Git mutation

The commit helper requires a symbolic branch and refuses observed merge, cherry-pick, revert, rebase, bisect, or index-lock markers. Under [ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), it also refuses when the private ownership fence does not grant this host a current `owner` verdict. A refusal returns the empty result and leaves the bytes in the working tree. The freshness commit applies the same grant. An owner's commits add the trailer `Lervo-Convergence-Host: <hostHash>`. It reads porcelain status, including untracked files, and selects:

- Present integrated draft bytes whose recorded preimage equals the current HEAD blob hash, including null for an absent path.
- Dirty present records and reviewed rewrite paths from current normalization records whose source hash matches HEAD or an integrated draft over that HEAD preimage.
- Deleted normalization source paths admitted by those records.
- Deleted superseded normalization records whose committed source path has an admitted replacement record.

Selection is sorted. Rename and copy parsing consumes the original-path status field without independently adding that original path. The selector relies on normalization inspection to establish current reviewed outputs.

## Formatting before the commit

When the repository depends on Prettier, the helper loads that Prettier from the repository root and formats with the repository's own configuration and `.prettierignore` before staging. It never writes formatter configuration. Formatting runs after selection, because selection matches reviewed bytes by hash. It applies to:

- every selected present path that no lifecycle owns after the commit;
- every path a selected record change releases from lifecycle ownership, because that path becomes the formatter's at this commit. A released path with uncommitted edits stays untouched for its developer.

Lifecycle ownership after the commit comes from normalization record outputs and managed or generated documents in the document ownership registry. It mirrors `scripts/quality/lib/format-ownership.mjs`. Those outputs and the ownership sources themselves keep their reviewed bytes. Formatted paths join the commit pathspec. The stage receipt records each formatting change as an approved effect with its before and after hashes, so the source fence accepts the formatting. If the commit fails, the helper restores the replaced bytes, and the next cycle selects the reviewed bytes again. A repository without Prettier commits the reviewed bytes unchanged.

## Staging and commit

The helper stages selected paths with `git add -A --`, then uses `git commit --only` with subject `docs: apply reviewed background knowledge`, an obligation-ID body, and `Lervo Knowledge <knowledge@lervo.invalid>` as both author and committer. The commit therefore does not depend on a developer or runner Git identity. Without an explicit committer, Git refuses the commit on hosts with no configured or derivable identity, such as CI runners. Other paths are omitted from the commit pathspec.

After success, the helper reads HEAD and its first parent. It returns committed paths and before/after coordinates only when that parent equals its observed pre-commit HEAD.

## Failure and concurrency limits

The inspected source does not establish an atomic selection-to-commit boundary. Safety markers are inspected before selection; this helper does not rehash selected content immediately before Git mutation. `headBlob` returns null for every caught Git read failure, not solely confirmed path absence.

Staging or commit failure returns an empty result with null HEAD coordinates, without explicit rollback of staging changes. Earlier inspection or selection errors can propagate. A post-commit parent mismatch also returns an empty result without undoing the commit. A null result therefore does not prove that Git or index bytes were unchanged.

Outer serialization, recovery, and authority must be verified separately before claiming protection against concurrent developer edits or uncertain effects.
