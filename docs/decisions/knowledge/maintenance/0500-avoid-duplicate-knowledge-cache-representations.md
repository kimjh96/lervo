# ADR-0500: Avoid duplicate knowledge cache representations

Status: `accepted`
Decision date: 2026-10-09
Amends: [ADR-0499](0499-reuse-content-bound-knowledge-preparation-projections.md)

## Context

ADR-0499 reduced fresh-process preparation median by 38.44 percent but increased warm peak RSS by 16.55 percent. Its whole-cache JSON conversion holds byte buffers, large strings, and decoded records at the same time. Lexical field reuse additionally stores frequency tuples and reconstructs maps for the search index. Releasing source-cache references after scanning did not establish a peak-RSS reduction.

The owner requested memory optimization. Reducing corpus coverage, result limits, freshness checks, or available history is not an acceptable implementation. Forcing garbage collection or changing heap limits would not remove the duplicate representations.

## Decision

The existing persistence adapter writes envelope schema 2 with Node's [V8 serialization API](https://nodejs.org/api/v8.html#serialization-api). The file still begins with the SHA-256 checksum of its payload and a newline. The payload contains `schemaVersion`, the exact Node/Unicode/ICU runtime coordinate, and the producer's opaque projection. Encoding and decoding operate on buffers directly, avoiding the intermediate whole-cache JSON string. Node-specific serialization remains inside the filesystem adapter; domain cache and search code do not import it.

Lexical field-analysis projection build `lexical-v2-field-analysis-v2` stores native frequency maps. The cache and index share their read-only map references within one preparation, avoiding tuple expansion and a second set of maps. All keys and counts are validated on reuse; a map's key uniqueness removes the separate duplicate-key set. Normalized text still comes from the current input, and the complete current corpus still determines global statistics, postings, scores, and ordering. The search engine coordinate and scoring adapter build ID do not change.

Binary bytes are transport, not canonical identity: equivalent values need not serialize identically. Source/content/build bindings retain their existing semantic definitions. Every cacheable source is still read and hashed. The source-unit format, unit identities, concept validation, materialization recovery, and publication checks are unchanged.

## Compatibility, privacy, and failure meaning

The three stable filenames, owner, retention classification, private permissions, checksum validation, atomic replacement, and 128 MiB per-file storage backstop remain unchanged. The backstop causes complete recomputation and does not omit inputs or outputs.

Old JSON files, unsupported envelopes, mismatched runtimes, corrupt binary payloads, and incompatible producer projections are cache misses. A successful preparation can replace them with schema 2. Older readers likewise miss on the binary payload and can rebuild their own projection. Mixed reader versions can cause repeated rebuilding, but cannot make an old cache current. No canonical migration or new event is required. Serialization or write failures preserve the fresh query result; failed preparation never publishes a projection.

The binary format does not encrypt or declassify data. Derived locators, titles, and token frequencies remain private local state. No raw source bodies are added. Public evidence contains counts, digests, timings, and memory measurements only.

## Verification

Compare the immediate pre-change cached implementation with the candidate in separate fresh processes, sharing current source bytes and frozen supplemental sources. Keep independent cache directories so one arm cannot evict the other's format. Run at least 30 alternating warm pairs, report cold creation separately, and verify complete response equality plus a full-computation reference. Include complete source/unit inventory equality, corruption, legacy-format replacement, runtime/schema mismatch, Unicode and native-map roundtrips, failed preparation, and the common lexical contract.

Report process peak RSS in KiB, heap/external/array-buffer bytes at preparation completion, preparation wall/CPU time, bootstrap, query time, and cache size. RSS includes process bootstrap and queries; end-of-preparation heap usage is not a peak or a post-GC retained-size estimate. Keep all samples, record competing workloads, and do not use GC or heap flags. A controlled benchmark establishes local preparation behavior, not Hit-quality uplift or installed fleet acceptance.
