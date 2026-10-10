# Context-quality retained conversation source recovery

Status: `source_inventory_verified_not_quality_qualified`
As of: 2026-10-10

The [earlier provenance audit](context-quality-provenance-recovery.md) inspected the local repository CAS and found no bodies at its observed request digests. This follow-up locates a different canonical source: the registered WSL repository's existing Discord interaction stores and their integration-owned artifact directories. The result changes the next quality step from locating original inputs to classifying and reviewing retained inputs. It does not turn messages into qualified task families.

## Current source evidence

The registered environment target was refreshed before connection. The configured SSH destination and Ubuntu bridge completed read-only commands. At 2026-10-09 16:19:10 UTC, the remote repository reported task-base HEAD `53eec5565af89eae2a18acd2d39cd99d78358a61` and 92 tracked dirty paths. This observation does not prove that the complete local candidate or its untracked files are installed remotely. No repository source, writer selection or service was changed.

The [redacted inventory](../context-quality-conversation-source-inventory-v1.json) binds the final audit harness and stdin execution bundle. Its final observation began at 16:35:39.575 UTC. Public owner modules validated normalized event schemas and canonical IDs, while the reader checked row/project/integration/conversation coordinates and each SQLite store's quick and foreign-key checks. Five owner packages' 168 compiled JavaScript files had the same aggregate digest before and after inspection. This is an owner-module identity, not a complete packaged-runtime attestation.

| Observation                                        | Result |
| -------------------------------------------------- | -----: |
| Physical inbox rows                                | 11,991 |
| Unique validated events                            | 11,959 |
| Duplicate copies across stores                     |     32 |
| Invalid normalized rows                            |      0 |
| Events whose normalized actor is human             |  1,068 |
| Human bodies matching digest, byte count and UTF-8 |  1,068 |
| Distinct human body digests                        |    779 |
| Human bodies below 40 bytes                        |    719 |
| Human bodies from 40 through 199 bytes             |    315 |
| Human bodies of at least 200 bytes                 |     34 |
| Human events with explicit reply links             |      0 |

The source range is 2026-09-07 through 2026-10-07. Private body bytes were read only on the owning host for digest/size/UTF-8 verification; neither the tool output nor tracked evidence contains those bodies or participant identities. The artifact path is derived from the existing conversation composition, which uses each integration's `artifacts` directory. Looking in the general repository CAS would incorrectly report these source bodies missing.

The two exact historical full-report hashes from the old four-case experiment are also absent at their declared hashes in the remote repository CAS. This follow-up therefore does not restore that experiment's exact context or corpus. The previous four reviewed retrieval regressions remain retained with their original limits.

## Reproduction and limits

On an authorized host with the harness available, run:

```bash
node scripts/evaluation/run-context-quality-conversation-source-audit.mjs \
  /path/to/authorized/repository \
  itg_discord01,itg_discord_elio01,itg_discord_elio02
```

The observed remote run delivered the same report module, reader module and entrypoint through standard input, removing only their relative import declarations and the duplicated crypto import. The recorded bundle hash binds those exact assembled bytes. It imported the owning repository's public built project, conversation and CAS modules; it did not copy the harness into that repository or start a provider.

The entrypoint only parses and renders. A reader adapter owns scoped read-only SQLite/CAS observation and owner-module identity checks; a separate report module owns bounded counting and privacy-safe aggregation. The audit accepts one through eight distinct integration selectors, at most 20,000 rows and 64 MiB of metadata. It checks the 64 KiB accepted body ceiling before and after the existing CAS read, without claiming a new atomic filesystem snapshot. Missing or corrupt bodies remain explicitly unavailable. A row/metadata bound stops the audit instead of producing a successful truncated result. Duplicate copies still undergo owner validation before deduplication.

Each source has its own SQLite read transaction; there is no fleet-wide atomic snapshot. One legacy store is schema version 1 and two are version 2. The audit validates normalized event identity and content bindings, not every interaction lifecycle transition or protective trigger. A complete inventory is therefore not complete interaction-store certification. The metadata digest binds exactly the rows observed; future ingestion can change it.

Thirteen focused tests cover privacy, canonical deduplication, foreign/stale coordinates, missing/corrupt/invalid/oversized bodies, actor separation, reply resolution, incomplete or repeated body observations, row/byte bounds, selector safety and timestamp offsets. Together with retained provenance and case-audit checks, 22 tests pass. This tooling is outside the bundled runtime and adds no runtime release intent.

Quality/structural checks, architecture checks for 103 packages and documentation lifecycle checks for 538 documents pass. The local v6 runtime build remains byte-identical, and the three harness hashes match the executed audit. Release completion against task base `53eec5565af89eae2a18acd2d39cd99d78358a61` reports `intent_pending` across 279 changed paths, not release readiness. All 273 paths from the preceding backup remain present; only two existing Markdown files changed in this slice, and all earlier protocol/evidence JSON bytes are preserved.

## Remaining quality work

The audit contributes zero newly qualified task families, zero reviewed ADR-0501 label sets and zero asserted held-out families. A normalized human message can be a greeting, short continuation, repeated request or manually posted test. Byte length and distinct hashes do not establish task diversity. With no explicit reply links, continuation cases need their chronological conversation context and source/corpus bindings recovered and reviewed; context must not be inferred from expected labels.

Prepare a private, provenance-bound family review packet from these retained inputs. Separate synthetic/operational probes, deduplicate semantic families, identify tuning exposure, and bind an explicit replay corpus and required clause/section/negative/artifact labels before review. Preserve at least 30 percent of task families from tuning and meet the planned population of at least 100 real families. Do not copy private conversation text into a public benchmark or call authored annotations human review. Both-provider repeated outcomes remain required after the population is valid.

The [v6 resource gates](context-quality-preparing-batch-repair.md) still fail, and installed reader-first rollout, recovery and the seven-day/task-count cohort remain unverified. Network/SSH/source-store availability does not prove live service health, complete reader inventory or installed acceptance.

## Private review preparation

A subsequent read-only capture prepared a private review packet at 2026-10-09 16:48:14 UTC. It contains all 1,068 normalized human messages and 1,643 agent messages, with 2,711 exact digest/size/UTF-8 body checks. The capture retained the same inbox metadata digest as the inventory above and rechecked owner-module identity. Local public-owner validation independently accepted all captured normalized event identities. No remote source, service, provider session or writer selection changed.

Unlike the preceding metadata-only audit, this step copied private bodies to an owner-local temporary directory outside the repository. Its directory is mode `0700` and files are `0600`; the bounded packet totals 8,107,594 bytes. It includes exact source records, per-message review entries, an escaped static HTML chronology, the capture/builder scripts and their hash manifest. The HTML has no scripts or external links and disables external resources through its content security policy. Independent checks verified every rendered body, exactly one review entry per human event, all source bindings, chronology references, file hashes and permissions. No body or participant identity is included in this document or a public benchmark.

| Private artifact     | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Source capture       | `ac33f60c7ed4725e7821ad35b77c6477fea3e1decf42f09538f4f260ff4adc9b` |
| Review entries       | `3972916d292ca01909edb4521c04ab92c927768d627141a748796d2e03cfd9e9` |
| Static review screen | `64fda9b6f0abb7bc18f89aa949cd82243b905b5b77bf01c9f12b81e67b7e23d1` |
| Stdin capture bundle | `9717f8b7e378c2ad26472621b1e0f87381f0c38e886168c7cc6b090f90224626` |

Retention is bounded to seven days: delete this task-specific private directory after review or by 2026-10-16 16:48:14 UTC. No scheduled deletion is installed; the checkpoint carries the cleanup obligation. The packet must not be silently renewed, published or used after expiry. Source coordinates permit a new authorized capture if needed.

The packet groups messages into 11 exact integration/conversation/thread chronologies. These are not semantic task families. Review entries reference preceding messages with a strictly earlier timestamp; equal timestamps do not prove order. System events and other threads are excluded. A complete observed chronology neither reconstructs the original provider input nor proves that every preceding message is relevant. Repository versions, authority scope and any missing cross-thread context remain unresolved.

Forty messages were previewed from 295 distinct bodies of at least 40 bytes. Their assistant-authored intent notes are explicitly unreviewed. The sample includes requests about other projects, continuations and possible operational probes; neither storage project ID nor a human actor establishes a Lervo task or a valid replay corpus. Suspected probes remain unconfirmed, and no heuristic exclusion has been promoted to ground truth. All 1,068 human events remain represented, including short messages.

Every case still has an unresolved semantic family, repository/corpus binding, tuning exposure and seven required label groups. Human review and quality eligibility remain unset/false, and no held-out split is assigned. Automatically captured messages that were not previewed cannot be claimed as unseen families. The packet prepares concrete review material; it contributes zero newly qualified families or reviewed label sets and makes no quality, performance or installed acceptance claim.

## Concrete private label drafts

A subsequent owner-local preparation adds label drafts for only the forty messages already previewed. The original source, 1,068 review entries and chronology screen remain byte-identical. A separate JSON artifact, escaped static review screen and reproducible builder propose task intent, evidence roles, irrelevant neighbors, historical-conflict risks and observable outcomes. They identify 34 tentative family groupings; these are hypotheses, not a semantically deduplicated or qualified population. The proposed groupings can still merge or split after complete context and repository review.

Each draft retains its exact message hash and prior-chronology reference. Repository and replay-corpus versions, applicable mandatory policy clauses and exact acceptable source/section versions remain unresolved. All seven label groups explicitly distinguish draft proposals from missing bindings. Historical-conflict notes describe risks, not observed contradictions. The task requesting one named document carries only the source/section names explicitly requested; no current corpus is substituted for task-era bytes. All cases remain unreviewed, ineligible and unassigned to a split. The two possible operational-probe requests have a concrete provenance question pending with the owner; until answered, their provenance stays unresolved.

Validation checks all forty unique source bindings, the seven label keys, exact prior-chronology references, all escaped rendered request/label text, no active or external HTML resources, unchanged original hashes, manifest hashes and owner-only permissions. No additional message body was semantically inspected beyond the earlier forty previews. The complete private directory now totals 8,327,929 bytes and keeps the original expiry, 2026-10-16T16:48:14Z. No private body, intent draft or grouping name is copied into tracked evidence. The new private artifact digests are:

| Artifact                   | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| Label drafts               | `8cb8e6384e27d46b57730c7d69cbe8ce8341db4456bb2ad3dbcf325cd46d7fde` |
| Static draft review screen | `3956f11be86b506d918ef563ecc1033821399663914abd832905c2038443eaa8` |
| Draft builder              | `a125f350e420d5d952ec082fb7bc0c1f9654b4f5e4be00c13d43576d516b4af1` |

This is progress toward reviewable labels, not human approval or full ADR-0501 label completion. Newly human-reviewed, qualified and held-out families remain zero. The 100-family population, thirty-percent unseen-family split, repeated providers, resource qualification and installed acceptance requirements remain unchanged. Delete the whole private packet after review or by its original expiry; no silent retention extension or public export is authorized.

## Historical completion and artifact linkage

A read-only follow-up at 2026-10-09T18:34:32.530Z compared only the forty already-previewed message IDs and request hashes with their integration repository-work stores. One selected request has a failed turn with no result; another has a completed turn and a matching canonical completion event. This is a bounded linkage observation, not evidence that other requests lack execution records.

The public event-store owner validates the completion event and a complete 87,803-event chain at the observation. Public CAS reads verify the exact 1,573-byte result in both its integration artifact store and the general CAS, plus an 8,739-byte workstream snapshot in the general CAS. Snapshot JSON reports revision 4; this observation verifies bytes and JSON fields, not the full snapshot domain contract. The result body and snapshot text are not exported into this report. Their hashes are `sha256:9d169bc771a0a39c6647cab374b1f283e852aab71b13a3236cc47ce8456f7296` and `sha256:304586359eefc0897ae8f84d011cb4c3d72f001889a2fc0ba61e4dd4e8c442ea`.

The completion has equal before/after repository observation digests but no source-manifest artifact reference. Such a digest combines repository HEAD and dirty-path observations; it is not a Git commit or retained corpus. The workstream snapshot has no repository-coordinate field. Neither artifact establishes the exact source corpus or original provider input. An unchanged successful work path can legitimately omit a changed-source manifest, so its absence is not labelled corruption.

The five direct owner packages contribute 175 JavaScript files and 838,547 bytes, unchanged before/after with digest `sha256:cc0b16ea2e97b5229eaaf1374501e941866a9a545c45076d9c966502372dfc13`. This is not the full dependency closure or an installed-candidate identity. No remote mutation, provider call or human label promotion occurred. These artifact links improve provenance while newly qualified and held-out families remain zero; corpus binding, human review and the original private-packet cleanup deadline remain open.
