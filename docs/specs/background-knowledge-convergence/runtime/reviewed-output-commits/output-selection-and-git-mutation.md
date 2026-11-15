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

The boundary stage's exact source fence proves that the repository equals the obligation's snapshot. The helper commits exactly that snapshot's bytes for the selected paths, or nothing:

- Right after the fence, with no await, the helper records each source's file type and executable bit. A committed path must still be a regular file with that mode; its tree entry is `100755` or `100644` accordingly, or the committed mode when `core.fileMode` is false.
- After every await of selection and formatting, each selected path is checked against the fenced snapshot. A present path is read without following links, and its bytes must hash to its snapshot hash; a formatted path's replaced content must, and its formatted content is what is committed; a deleted path must be absent from the snapshot. Any mismatch restores the formatted files and refuses with `source_bytes_changed`.
- The checked bytes stay in memory. Blobs are written from them with `git hash-object -w --no-filters`, so no clean filter or line-ending conversion runs and the working tree is never read again. A private index starts from the fenced HEAD (`read-tree`), takes those blobs (`update-index --cacheinfo`) or removals, and `write-tree` builds the tree.
- `commit-tree` records it with the fenced HEAD as parent. No hook runs. `commit.gpgsign` is read as a boolean: an invalid value, or a signing failure, gives way without a commit; a true value signs with `-S` under the repository's own `gpg.format` and `user.signingkey`.
- The helper then takes the developer's `index.lock` exclusively, as `git commit` does, and holds it until the developer's index is updated. An existing lock, or any merge, cherry-pick, revert, rebase, sequencer or bisect marker seen under the lock, gives way before HEAD moves. A split index gives way too.
- Under the lock, a copy of the developer's index takes the committed entry for each path only where its entry still equals the fenced HEAD's. A path the developer staged differently keeps the developer's entry and shows as a staged change. The copy becomes the lock's content.
- HEAD moves by `update-ref HEAD <new> <fenced HEAD>` under Lervo's identity, so the reflog names Lervo Knowledge and a concurrent commit makes the helper return an empty result. Renaming the lock over the index then publishes the developer's index; if that fails, HEAD moves back.

The commit carries:

- Subject: `docs: apply reviewed background knowledge`.
- Body: the obligation ID.
- Author and committer: `Lervo Knowledge <knowledge@lervo.invalid>`.

The commit does not depend on a developer or runner Git identity. An edit made after the fence stays in the working tree, uncommitted.

## Failure and concurrency limits

Safety markers are inspected before selection. `headBlob` returns null for every caught Git read failure, not only confirmed path absence. A failure while writing blobs, building the tree, signing or moving HEAD returns an empty result and restores the formatted files; blobs already written stay as unreachable objects. A developer Git command that needs the index while the helper holds the lock fails with Git's usual `index.lock` message.

Outer serialization, recovery, and authority require separate verification before claiming protection against concurrent developer edits or uncertain effects.
