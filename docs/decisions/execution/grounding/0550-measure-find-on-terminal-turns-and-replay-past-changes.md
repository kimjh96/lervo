# ADR-0550: Measure Find on terminal turns and replay past changes

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0535](../applications/0535-project-core-health-with-actor-owned-attention.md) (Find measure and event history), [ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) (evaluation)
Related: [ADR-0541](0541-bind-agent-queries-to-the-turn-and-observe-path-references.md) (terminal selection and path mentions)

## Context

The core outcomes require Find to be measured two ways. Operation: hits from selected and referenced receipts. Evaluation: recall and precision on a replay set from past changes. On 2026-11-01 neither worked.

- **The health measure could not see terminal turns.** It proved Find only from `context.injected` and `context.referenced`, which only managed runs record. Compact terminal turns record selection and citation on `terminal.turn.observed` (`selectedCount`, `pathMentionCount`, [ADR-0541](0541-bind-agent-queries-to-the-turn-and-observe-path-references.md)). Every terminal-only repository therefore showed "Find unproven", whatever Find did.
- **The event history became partial with use.** The health reader stopped after 10,000 matching events counted from the oldest. On WSL, `lervo` already held 6,105, mostly `terminal.context.prepared`. Prompt volume alone would soon turn Find and the longest stop into `unknown`.
- **No replay set existed.** Precision and recall existed only in scripted canaries.

The terminal data shows a real gap. On the Mac checkout of `lervo`, 106 turns since 2026-10-31 had 1 with selected documents and 0 path citations; `axli` had 24, 0, and 0.

## Decision

### Find counts terminal turns

The Find value adds `turnCount`, `selectedTurnCount`, and `pathMentionCount` from `terminal.turn.observed` in the seven-day window. Either channel proves Find:

- managed runs: an injection in the window and at least one `context.referenced`;
- terminal turns: at least one turn that selected documents, and at least one path citation.

The gap line names the terminal ratio, for example "1/106 turns selected governing documents, 0 cited". A path citation remains a proxy for use, as ADR-0541 says.

### The history keeps whole stages and a recent activity window

Stage and convergence records are kept whole, so a long stop keeps its start. Per-turn activity (`context.injected`, `context.referenced`, `terminal.context.prepared`, `terminal.turn.observed`) older than eight days is dropped while reading. The reader scans at most 250,000 matching events and retains at most 10,000. Only retained overflow or the scan bound makes the history partial.

### A provider-free replay set from past changes

`lervo knowledge find-replay [--cases <1..200>] [--limit <1..32>]` builds cases from up to 600 recent non-merge commits not authored by Lervo. A case is a commit that changed code and governing documents together:

- target paths: changed sources classified as code or configuration, excluding `.lervo/` and `.changes/`;
- expected documents: co-changed Markdown classified as instructions, portable skills, or canonical documents that still exist.

Each case is asked through the same projected task query and product ranker an agent query uses. Its result is scored by recall, precision, first rank, hit rate, and mean reciprocal rank. The report is written to `.lervo/state/find-replay.json`. The background health prefetch reruns it when the last report is older than seven days, and records an empty report on failure so it does not retry every prefetch. The Find gap line shows the last replay's recall and precision.

Co-changed documents are a proxy for "the governing rules and canon of the changed paths". Independent reviewer confirmation of expected documents is not part of this decision.

## Baseline

The first replay (40 cases, top 8, 2026-11-01, Mac checkouts):

| Repository | Cases | Recall | Precision | Hit rate |   MRR |
| ---------- | ----: | -----: | --------: | -------: | ----: |
| `lervo`    |    40 |  0.245 |     0.144 |    0.725 | 0.441 |
| `axli`     |    40 |  0.243 |     0.053 |    0.375 | 0.236 |
| `flemo`    |    35 |  0.267 |     0.082 |    0.457 | 0.279 |
| `plen`     |    15 |  0.356 |     0.092 |    0.467 | 0.294 |
| `shiflo`   |    40 |  0.191 |     0.063 |    0.375 | 0.206 |

Evidence and research documents often outrank decisions and specifications. Reranking the top 32 with a document-class prior raised `lervo` recall to 0.288 and MRR to 0.506, and moved `axli` and `flemo` by one to three points. That is too small to change product ranking on this evidence; later ranking changes are judged against this replay.

## State, events, privacy, and failure meaning

- The Find value gains optional `turnCount`, `selectedTurnCount`, `pathMentionCount`, and `replay` (`observedAt`, `caseCount`, `recall`, `precision`). Readers accept projections without them.
- `.lervo/state/find-replay.json` is private, mode `0600`, and deletable. It holds commit hashes and counts, never commit messages, queries, or paths.
- No event is added.
- An empty replay (`caseCount: 0`, null rates) means there was nothing to replay, or the replay failed. It never counts as good Find.

## Verification

- `apps/cli/test/repository-health-projection.test.ts` covers terminal proof, the gap ratio, and windowed history.
- `apps/cli/test/find-replay.test.ts` covers classification, scoring, case collection that excludes Lervo commits and code-only commits, and report state.
