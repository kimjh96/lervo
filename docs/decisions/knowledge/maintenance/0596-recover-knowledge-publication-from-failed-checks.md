# ADR-0596: Recover knowledge publication from failed checks

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (the publication settings gain `checks.ignore`, and the publication state gains `checksRetry`), [ADR-0594](0594-keep-knowledge-publication-moving-and-apply-owner-rules-on-every-host.md) (a failed check on an unchanged head is now recovered or backed off, not only a replay conflict)
Related: [ADR-0473](../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)

## Context

On 2026-11-19 the WSL owner had not published shiflo knowledge since 2026-10-12. Pull request #64 held the 7 unpublished commits, and its checks had failed that day:

- **Three Actions jobs never started.** GitHub annotated each with "The job was not started because recent account payments have failed or your spending limit needs to be increased." The conclusion was still `FAILURE`, and the rollup timed each like a job that ran for two seconds.
- **Two Vercel commit statuses failed.** Vercel blocks a preview when GitHub cannot match the commit author to an account, and every knowledge commit is authored by `Lervo Knowledge <knowledge@lervo.invalid>`. This repeats on every push.

The publisher never recovered:

1. **It never pushed again.** The 7 local commits replayed to the same trees on the unchanged `origin/main`, so the publisher kept the published head and pushed nothing, and no check ran again.
2. **It read the old failure as current.** The checks for the head were the 2026-10-12 results, reduced to "5 of 8 checks failed" with no check named.
3. **It never slowed down.** A failed publication skipped the "unchanged" shortcut and ran after every resident observation: a fetch, a tip build, and `gh pr view` about every 2.5 minutes. That was 9,346 recorded occurrences since 2026-11-03.

ADR-0594 handles a replay conflict. A failed check on an equivalent head had no recovery and no backoff.

## Decision

1. **Name each failed check.**
   - The checks summary keeps up to 8 failed items with their name, kind (`check_run` or the outside `status`), conclusion, and the Actions run and job behind a check run. The count still covers every failed item.
   - A failed Actions job with no steps reports `not_run`: GitHub refused to start it.
   - The failure detail names them, for example `5 of 8 checks failed: Lint and convention tests (not_run); Vercel – shiflo-web-next (failure)`. It is bounded to 480 characters and holds no stderr, path, or URL.
2. **Rerun a transient failure once per head.**
   - Check runs that concluded `not_run`, `cancelled`, `timed_out`, `startup_failure`, or `stale` belong to Actions runs. The publisher starts those runs' failed jobs again with `gh run rerun <run> --failed`, at most once for each published head, and waits for them as `awaiting_checks`.
   - GitHub refuses to rerun a run older than a month. The publisher then closes and reopens the pull request, which starts its pull request workflows on the same head.
   - A real `failure` and an outside status are never rerun: the same bytes would fail again, and each rerun costs Actions minutes.
   - A rerun the forge refuses still counts as that head's one rerun.
3. **Back off failed checks while nothing changes.**
   - After a failed observation the publisher waits 15 minutes, then 1 hour, then every 6 hours before it reads the same head again.
   - While it waits, it makes no fetch and no forge call, and reports `unchanged`.
   - A new knowledge commit, a moved local base, or a new published head ends the wait at once. The inventory key is a digest of the local base and the unpublished commits.
4. **Let the operator ignore outside statuses by exact name.**
   - `publication.checks.ignore` in the host's convergence owner configuration lists 1 to 8 exact check or status names, each 1 to 100 printable characters, with no repeats. A listed item neither passes nor blocks.
   - The publisher never guesses: a repository without readable required checks still blocks on every reported check.
   - The list does not make a derived configuration operator-owned. Derivation carries it into what it writes, and the configuration hash leaves it out.

### States, privacy, and failure meaning

- `checksRetry` in `.lervo/state/knowledge/knowledge-publication.json` (private, mode 0600) holds `head`, `inventoryKey` (`sha256:` digest), `attempts`, `retryAt`, and `rerun`. It applies only to the head it names. An invalid record is dropped, which costs at most one early check read.
- The failure code stays `knowledge_publication_checks_failed`. Its occurrences now grow by about 4 a day at the 6-hour step instead of about 580.
- The new forge step `rerun` reports `gh rerun exit <code> <class>` like the other steps.
- The behavior lives in the shared runtime, so the CLI host and the Node resident behave the same on every host. The ignore list is host configuration like the rest of `publication`, so every host that can own a repository needs the same list.

## Consequences

- shiflo's 3 billing-blocked jobs run again once on the unchanged head. With `checks.ignore` set to the two Vercel statuses on the owner host, pull request #64 merges once they pass, and the local `main` catches up.
- A real check failure stays visible with its check named and is read again at most every 6 hours, until a new knowledge commit or base starts a new head.
- A pull request merged or closed by hand while the publisher waits is noticed after the current wait, at most 6 hours later.
- **Rollback:** revert this change. Publication again reads stale failed checks every cycle and never recovers them.

## Verification

`packages/repository-knowledge-runtime/test/`:

- `knowledge-publication.test.ts`:
  - a never-started job is rerun once per head;
  - the failed checks are named;
  - nothing reaches the forge during the wait;
  - the second wait is 1 hour;
  - a new commit starts a new head with its own rerun;
  - a real failure and an outside status are never rerun;
  - the GitHub adapter reads job steps, applies `ignore`, and reopens when a rerun is refused;
  - at most 8 failures are named.
- `knowledge-publication-checks.test.ts`: settings validation, backoff steps, rerunnable runs, the bounded detail, the wait predicate, and dropping an invalid retry record.
- `convergence-owner-host-derivation.test.ts`: derivation keeps an operator's ignore list and still follows the remote.
