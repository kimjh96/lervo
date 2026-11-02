# ADR-0549: Tell the owner what Lervo learned after development

Status: `accepted`
Decision date: 2026-11-01
Implements: [core outcomes](../../../product/vision/core-outcomes.md) (Know felt outcome)
Related: [ADR-0545](../../knowledge/documents/capture/0545-apply-owner-stated-rules-without-a-review-command.md) (owner-stated rules), [ADR-0548](0548-report-convergence-where-it-runs-and-record-when-stops-are-shown.md) (prepared delivery)

## Context

The Know felt outcome says that after development, the owner receives a short notice of what Lervo learned, which canonical documents changed and why, and what they link to. It is information, not a task.

Nothing delivered it. In October, Lervo made 117 commits in `lervo` and 57 in `axli`. Almost every subject was "docs: apply reviewed background knowledge". The owner could not see what Lervo had learned, and the work did not feel delivered.

Lervo's commits are already the canonical record of what it changed. They reach every host through Git, including hosts that do not own convergence. Their subjects already distinguish owner rules, canonical knowledge, and background updates.

## Decision

### Build the notice from Lervo's own commits

The background health prefetch builds the notice. It never runs on the prompt path. It reads the commits by the Lervo knowledge identity from the last shown point up to the current HEAD, or from the last 24 hours on the first run or when that point is not an ancestor of HEAD. The newest 500 are itemized and older ones are counted. Once shown, the cursor moves to that HEAD, so merged histories are never revisited. It classifies each changed path:

| Kind         | Source                                                                                                                                   | Shown as                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `owner_rule` | "apply an owner rule", "retire an owner rule", the older "apply a reviewed owner rule", or any path under `docs/instructions/generated/` | The rule's heading and path, the rules it replaced, or "retired"                                 |
| `skill`      | Any path under `.agents/skills/<name>/`                                                                                                  | The skill name                                                                                   |
| `canonical`  | "apply reviewed canonical knowledge"                                                                                                     | Heading, path, "from development", and up to three repository links the change added             |
| `freshness`  | "refresh `<path>` from evidence" or "archive `<path>` as historical" with `Lervo-Freshness-*` trailers (ADR-0561)                        | Path, reason, cross-check verdict, and the revert command; one entry per commit                  |
| `effect`     | Any commit with a `Lervo-Effect` trailer: cross-checked layout, migration, bridge, bootstrap, normalization, or structure (ADR-0561)     | Effect, reason, cross-check verdict, and `lervo knowledge revert <commit>`; one entry per commit |
| `updated`    | "apply reviewed background knowledge"                                                                                                    | Path                                                                                             |

Generated indexes and `.lervo` paths are left out, because they restate other changes. Each path appears once, with its newest reason. At most 16 entries are kept, and every kind is counted.

### Show it once, as information

The next compact owner turn adds one line of at most 480 bytes. It is optional context: it is added only after owner rules and find pointers fit in the turn budget, so it never displaces them. It begins "Lervo learned since it last reported (information, no action needed)". Owner rules, skills, and canon come first. Whole items survive the cap, and the rest are counted. The line ends with the `git log` command that shows the details.

After the hook prepares a turn that contains the line, it records the newest covered commit. A later turn does not repeat the notice. Like ADR-0548, this proves `prepared` delivery only.

### Owner-rule notices (ADR-0561)

[ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) makes this notice the after-the-fact report of a stored owner rule. A rule file added in an owner-rule commit is shown as `stored owner rule "<title>" (<path>)`, followed by `(replaced <rule-id>, …)` when the same commit deleted older generated rules. A rule file deleted on its own is shown as `retired owner rule <rule-id>`. When any rule was stored, the line names the undo: `lervo knowledge instruction retire <rule-id>`. Entries add the optional `replaced` and `retired` fields; older notice files without them stay valid.

### Freshness notices (ADR-0561)

Under ADR-0561, Lervo applies document freshness changes itself, so this notice is the after-the-fact report of each one. The apply commit carries `Lervo-Freshness-Candidate`, `Lervo-Freshness-Reason`, and `Lervo-Freshness-Cross-Check` trailers. The notice reads them and shows `refreshed <path> (reason <reasons>; cross-check <verdict>; undo: lervo knowledge freshness revert <candidate-id>)`, or `archived <path> (…)` for an archive, ordered after canon and before background updates. Entries add the optional `freshness` field and counts add `freshness`; an older notice file without that count is rebuilt.

### Effect notices (ADR-0561)

Lervo applies a cross-checked layout, continuation migration, instruction bootstrap or bridge, document normalization, or document structure change itself and commits it on its own. The commit carries `Lervo-Effect`, `Lervo-Effect-Plan`, `Lervo-Effect-Reason`, and `Lervo-Effect-Cross-Check` trailers. Entries add the optional `effect` field and counts add `effect`; an older notice file without that count is rebuilt.

Every `freshness` and `effect` entry carries the ADR-0561 notice fields `{effect, targets, reason, crossCheck: {reviewers, verdict}, undo}`. For a commit, `targets` are up to eight changed paths and `crossCheck` is parsed from the trailer: `agreement N/N (<reviewer>; …)`, `<reviewer> agreed`, or `<reviewer> approved` give verdict `agree` and the named reviewers, and any other text is kept as the verdict. The notice shows `applied <effect> on <targets> (reason <reason>; cross-check <verdict> by <reviewers>; undo: <command>)`, ordered after freshness and before background updates. A notice file with the earlier string-valued `crossCheck` is invalid and rebuilt.

### Effects without a commit (ADR-0561)

Some effects have no commit of their own: provider hook files, capability installs and migrations, skill authorization, a derived-state reset, the workforce and Node upgrade stages, workstream head reconciliation and restore, and a replica backup branch. Each records one notice with the same fields in the durable private journal `.lervo/data/effect-notices.json` (`schemaVersion: 1`, at most 64 notices, each with `noticeId` and `occurredAt`). The CLI records its own effects, and the Node records workstream reconciliation and replica backups for its repository. Targets are bounded identifiers, such as paths, plan IDs, branches, and content hashes; reviewers name sessions or checks, never a person. A notice whose `noticeId` is already recorded is ignored.

The prefetch adds journal notices newer than the last shown one, or from the last 24 hours on a first run, as `effect` entries beside the commits. The notice file adds `noticesThrough`, the newest journal notice it covers, and the cursor adds `noticesShownThrough`. A turn shows the notice when either a new commit or a newer journal notice exists. A cursor written before the journal counts as shown through its `shownAt`. A failed journal write loses that notice and never fails or undoes the effect.

## State, events, privacy, and failure meaning

- `.lervo/state/learned-notice.json` (`schemaVersion: 1`, `observedAt`, `throughCommit`, `counts`, `entries`, optional `noticesThrough`) and `.lervo/state/learned-notice-cursor.json` (`schemaVersion: 1`, `shownThrough`, `shownAt`, optional `noticesShownThrough`). Both are private, mode `0600`, bounded, and deletable. They hold repository paths and headings that are already in the repository, and no content or provider output.
- No event is added. Git is the canonical source for committed effects; the files are projections. The ADR-0561 effect notice journal is the durable record of effects without a commit; it is bounded to 64 notices and survives `lervo state reset`.
- A failed build or write loses one notice and never blocks a prompt. A missing or invalid file shows nothing. A deleted cursor shows the last 24 hours again.

## Limits

"Why" is the reason class each commit records, not the canonical assessment's rationale, which Git does not carry. Rationale per document needs the integration commit to record it. That is a separate change.

## Verification

`apps/cli/test/learned-notice.test.ts` covers classification, added links, the cursor, merged histories, a non-ancestor cursor, non-ASCII paths, the byte cap, and state validation. On the Mac checkout of `lervo`, the notice for the five newest Lervo commits names the owner rule "Use Korean for owner-facing responses." and the updated documents.
