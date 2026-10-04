# 2026-09-20 repository-context source-bound correction

## Failure and source correction

Vero owned human `#axli` message `1551067083708829779` at `03:06:50Z` and selected `continue_work`. Native work failed once with `knowledge_source_limit_exceeded`; the inbox recorded `response_context_unavailable`. Vero delivered fixed failure message `1551068056741093498` at `03:10:42Z`.

Read-only reproduction of the installed AXLI knowledge query returned `Read source bytes exceed the policy limit.` The 32 MiB policy excluded `.venv` but not generated `.mypy_cache` trees, admitting about 58.3 MB of text, mostly those caches. Discord ownership and Gateway delivery were not the cause.

The common knowledge scanner now excludes conventional generated tool-cache directories at every depth, including under older tracked policies lacking those patterns. New default policies record the same exclusions; the common repository snapshot also excludes those directories.

A separate installed CLI query failure in the Lervo control repository came from accumulated supplemental execution events. Interactive CLI query and product search now use the existing bounded 4,096-event context collector, selecting by event sequence. Full lifecycle collection and canonical event history remain separate.

## Validation

Focused cache, snapshot, event-window, CLI, and reviewed-canary tests passed. Mac quality, documentation, type, build, release-manifest, and SBOM checks passed. The final full Mac run passed 3,906 tests with eight conditional skips; 44 focused WSL tests passed. No reviewed canary digest changed.

## r38 deployment

Linux Node distribution `sha256:df12b8dc2ae0843879f71cf27b2400edd9c15cf964ae78be440ff4057c78cfb8` (`runtime-df12b8dc-r38`) was archive-verified, installed immutably, and preflighted against all seven owner-only configurations. AXLI was upgraded first, then Shiflo, Plen, Flemo, Arca-next, Digimon, and Elio. Exact predecessor definitions were retained owner-only for rollback.

CLI bundle `sha256:9c83f6361dba0918a10651dbcd65b74effb57ac8ce1f09a856e566c15c4920eb` was deployed immutably as `settled-9c83f636-r38` on WSL and Mac, smoke-tested against AXLI and Lervo, and bound in all seven remote Node configurations without changing other fields. A second exact-definition upgrade activated the bindings.

Final inspection found all seven services active on r38 with zero restarts, matching health process IDs, conversation and sync `ready`, and successful installed-CLI knowledge queries. Six were overall `ready`; AXLI remained separately `degraded` solely because supervision still reported `aggregate_budget_exceeded`. Hub runtime does not consume repository knowledge and was not restarted.

## Open acceptance

No new human-authored `#axli` message appeared after activation. Installed CLI queries and Node readiness prove repository-context recovery, but successful completion of a new Vero Discord work turn remains the installed conversation criterion. The failed turn was not replayed, and selected review approval was unchanged. CLI release completion remains `intent_pending` at the existing 128-intent bound, distinct from operational deployment.
