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

| Kind         | Source                                                                          | Shown as                                                                             |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `owner_rule` | "apply a reviewed owner rule", or any path under `docs/instructions/generated/` | The rule's heading and path                                                          |
| `skill`      | Any path under `.agents/skills/<name>/`                                         | The skill name                                                                       |
| `canonical`  | "apply reviewed canonical knowledge"                                            | Heading, path, "from development", and up to three repository links the change added |
| `updated`    | "apply reviewed background knowledge"                                           | Path                                                                                 |

Generated indexes and `.lervo` paths are left out, because they restate other changes. Each path appears once, with its newest reason. At most 16 entries are kept, and every kind is counted.

### Show it once, as information

The next compact owner turn adds one line of at most 480 bytes. It is optional context: it is added only after owner rules and find pointers fit in the turn budget, so it never displaces them. It begins "Lervo learned since it last reported (information, no action needed)". Owner rules, skills, and canon come first. Whole items survive the cap, and the rest are counted. The line ends with the `git log` command that shows the details.

After the hook prepares a turn that contains the line, it records the newest covered commit. A later turn does not repeat the notice. Like ADR-0548, this proves `prepared` delivery only.

## State, events, privacy, and failure meaning

- `.lervo/state/learned-notice.json` (`schemaVersion: 1`, `observedAt`, `throughCommit`, `counts`, `entries`) and `.lervo/state/learned-notice-cursor.json` (`schemaVersion: 1`, `shownThrough`, `shownAt`). Both are private, mode `0600`, bounded, and deletable. They hold repository paths and headings that are already in the repository, and no content or provider output.
- No event is added. Git is the canonical source; the files are projections.
- A failed build or write loses one notice and never blocks a prompt. A missing or invalid file shows nothing. A deleted cursor shows the last 24 hours again.

## Limits

"Why" is the reason class each commit records, not the canonical assessment's rationale, which Git does not carry. Rationale per document needs the integration commit to record it. That is a separate change.

## Verification

`apps/cli/test/learned-notice.test.ts` covers classification, added links, the cursor, merged histories, a non-ancestor cursor, non-ASCII paths, the byte cap, and state validation. On the Mac checkout of `lervo`, the notice for the five newest Lervo commits names the owner rule "Use Korean for owner-facing responses." and the updated documents.
