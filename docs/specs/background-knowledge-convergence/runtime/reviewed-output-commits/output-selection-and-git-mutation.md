# Output selection and Git mutation

The commit helper requires a symbolic branch and refuses observed merge, cherry-pick, revert, rebase, bisect, or index-lock markers. It reads porcelain status, including untracked files, and selects:

- Present integrated draft bytes whose recorded preimage equals the current HEAD blob hash, including null for an absent path.
- Dirty present records and reviewed rewrite paths from current normalization records whose source hash matches HEAD or an integrated draft over that HEAD preimage.
- Deleted normalization source paths admitted by those records.
- Deleted superseded normalization records whose committed source path has an admitted replacement record.

Selection is sorted. Rename and copy parsing consumes the original-path status field without independently adding that original path. The selector relies on normalization inspection to establish current reviewed outputs.

The helper stages selected paths with `git add -A --`, then uses `git commit --only` with subject `docs: apply reviewed background knowledge`, an obligation-ID body, and author `Lervo Knowledge <knowledge@lervo.invalid>`. It does not override committer identity. Other paths are omitted from the commit pathspec.

After success, the helper reads HEAD and its first parent. It returns committed paths and before/after coordinates only when that parent equals its observed pre-commit HEAD.

## Failure and concurrency limits

The inspected source does not establish an atomic selection-to-commit boundary. Safety markers are inspected before selection; this helper does not rehash selected content immediately before Git mutation. `headBlob` returns null for every caught Git read failure, not solely confirmed path absence.

Staging or commit failure returns an empty result with null HEAD coordinates, without explicit rollback of staging changes. Earlier inspection or selection errors can propagate. A post-commit parent mismatch also returns an empty result without undoing the commit. A null result therefore does not prove that Git or index bytes were unchanged.

Outer serialization, recovery, and authority must be verified separately before claiming protection against concurrent developer edits or uncertain effects.
