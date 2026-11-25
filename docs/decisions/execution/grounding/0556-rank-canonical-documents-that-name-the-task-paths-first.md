# ADR-0556: Rank canonical documents that name the task's paths first

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0550](0550-measure-find-on-terminal-turns-and-replay-past-changes.md) (ranking judged by replay)
Amended by: [ADR-0562](../../foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md)
Related: [ADR-0552](0552-check-changes-against-the-canon-that-names-them.md) (governing index)

## Context

[ADR-0550](0550-measure-find-on-terminal-turns-and-replay-past-changes.md) added `lervo knowledge find-replay`. It replays past commits that changed code together with governing documents and asks whether the query would have found those documents. Recall at 10 was low: 0.19–0.38 across six repositories. A class-prior rerank moved it only slightly, so ranking was left unchanged.

[ADR-0552](0552-check-changes-against-the-canon-that-names-them.md) built a governing index: for each code or configuration path, the current canonical documents that name it with a strong reference. A replay case's expected documents are exactly the canonical documents changed alongside its code, so the index is a direct signal that the lexical ranker lacks.

An offline replay compared ways of merging governing documents into the ranked list, at 10 results over up to 40 cases per repository:

| Repository | Ranked only | Top 3 governing first | Top 5 governing first | All governing first |
| ---------- | ----------- | --------------------- | --------------------- | ------------------- |
| lervo      | 0.330       | 0.380                 | 0.375                 | 0.341               |
| axli       | 0.256       | 0.360                 | 0.467                 | 0.579               |
| flemo      | 0.229       | 0.273                 | 0.411                 | 0.397               |
| shiflo     | 0.213       | 0.231                 | 0.231                 | 0.231               |
| plen       | 0.375       | 0.375                 | 0.375                 | 0.375               |

Putting every governing document first lowered `lervo`'s hit rate from 0.725 to 0.650, because its documents name many paths. Five was the largest cap that left every repository at or above the ranked-only recall and hit rate.

## Decision

When a query has target paths, up to five canonical documents that name them come before the ranked results:

- **Targets.** `--path` values, plus repository paths written in the query sentence that exist in the checkout. Agents usually write paths into the sentence, as `AGENTS.md` asks.
- **Order.** Weight first: how many targets a document names, through the path or a containing directory. Ties keep the ranked order, read to a depth of 32, and then sort by path.
- **Eligibility.** Only documents in the knowledge index count; a document that has no concept yet cannot be recommended. Historical documents stay excluded unless the query asks for history.
- **Merge.** The rest of the list keeps its ranking, without duplicates, up to the requested limit.

`lervo knowledge find-replay` uses the same preference, so the replay keeps measuring the product ranking.

A missing or unreadable governing index prefers nothing; the ranked list is unchanged.

## Events, states, privacy, and failure meaning

- No event or schema changes. Hits keep their shape; a preferred document outside the ranked page carries score 1.
- Historical documents are excluded inside the ranker (`exclude`), not by asking it for more results. Until 2026-11-22 the ranked depth grew by one for each withheld document. Once a repository held more than 30 historical documents, the depth passed the engine's 50-result bound, and every `lervo knowledge query` and terminal context selection failed with `invalid_query`.
- The governing index stays the host-private `.lervo/state/governing-index.json` of ADR-0552.
- The replay can overstate the gain slightly: today's governing index includes references written after a replayed commit. It measures the ranking an agent gets now, not the one it would have had then.

## Verification

Focused tests show:

- at most five preferred documents lead, ordered by weight, then ranked order, then path;
- historical and unindexed documents are never preferred, and no preference leaves the list unchanged;
- only existing repository paths in a sentence become targets, never `..` paths or free words;
- governing weights count every target a document names.

The product `lervo knowledge find-replay --cases 40 --limit 10` measured recall of 0.375 for `lervo`, 0.387 for `axli`, 0.411 for `flemo`, 0.231 for `shiflo`, and 0.375 for `plen`. The ranked-only mean was 0.281; the new mean is 0.356, and no repository's recall or hit rate fell.
