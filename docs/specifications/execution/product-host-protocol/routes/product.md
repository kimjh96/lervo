# Product routes

| Route                                 | CLI prefix                                                               | Authority |
| ------------------------------------- | ------------------------------------------------------------------------ | --------- |
| `product_activity.inspect` (v8)       | `application activity --json`                                            | read-only |
| `product_search.inspect` (v9)         | `application search --corpus repository_knowledge --json <query>`        | read-only |
| `product_observability.inspect` (v10) | `application observability --work <work-id> --json`                      | read-only |
| `product_deliberation.inspect` (v11)  | `application deliberation --deliberation <id> --integration <id> --json` | read-only |

The route returns `ProductActivityPageV1` from a verified canonical event-chain head and an exact repository revision. It accepts an optional opaque cursor and a limit from 1 through 100. It opens repository storage read-only, scans cursor identity with bounded memory, and projects at most `limit + 1` events.

The result contains classifications and opaque evidence coordinates, never event payload bodies. A cursor absent from the verified chain returns `activity_cursor_stale`; invalid evidence and unsupported event schemas remain distinct failures. The route grants no write, approval, provider, delivery, or lifecycle authority.

Discord and future first-party surfaces consume this same contract. Rendering, polling, and transport-specific subscription behavior remain outside the route and may not reinterpret a failed page as empty success.

Protocol v9 adds the first `ProductUnifiedSearchResultV1` corpus adapter. It composes the existing repository-knowledge lifecycle and qualified Lexical v2 ranker, checks that repository revision is unchanged across the query, and returns query and authorization digests, exact engine and adapter-build coordinates, a completed stage receipt, stable knowledge coordinates, and content hashes. Query text, source bodies, paths, native scores, and relation bodies are absent from the product result.

Only `repository_knowledge` is installed in v9. Other typed corpus classes remain unavailable until their owning conversation, artifact, canvas, deliberation, approval, verification, work-event, or code adapter can prove current authorization and source validation. This is an additive federated-search boundary, not a claim that one universal index exists.

Protocol v10 adds `SurfaceObservabilityReportV1` for one managed work ID. The CLI opens canonical storage read-only, verifies and freezes an exact event-chain head, reads no more than 100,000 events from that prefix, projects the existing `WorkExecutionReportV1`, and rejects a repository revision change during inspection. The result preserves provider and causal resource scopes, every observed token dimension, cached-input tokens as a separate cache observation, the stage catalog and execution-profile coordinates, and terminal run state. Grounding, search, verification, acceptance, artifact, publication, and delivery measurements remain explicitly unavailable or partial until their canonical readers are composed.

An optional origin coordinate can bind the same report to a Discord thread or future first-party surface without changing the underlying execution evidence. The route grants no write, provider, approval, result-publication, delivery, or steering authority.

Protocol v11 adds `ProductDeliberationViewV1` for one installed conversation deliberation. The reader opens the start and resume queues without creating or migrating them, freezes one verified repository event head and repository revision, and joins the exact origin, embedded policy or an exact hash-matching legacy policy, structured artifacts, verification result bytes and suites, terminal outcome, organization participant bindings, work-resource coordinate, writing permit, and adapter delivery receipt. It reads the queue and delivery sources twice and rejects a change during projection.

New `deliberation.started` events optionally embed the complete provider-neutral policy. The policy contains no topic, prompt, reasoning, provider response, credential, or native platform identifier. Hash-only predecessor events remain valid; v11 uses the current policy source only when it recreates the recorded policy hash exactly. Otherwise, exact projection is unavailable rather than reinterpretation of the historical decision.

The route reports policy-only execution roles honestly and accepts a hired-agent binding only when its deliberation, policy hash, role, semantic role version, provider selection, and provider-policy hash agree. A terminal notification's `accepted` state supplies no delivery claim. Publication is present only after one exact writing-gated outbound exists, and origin delivery is present only after that outbound carries a durable adapter receipt for the immutable conversation and thread. Multiple outbounds, contradictory coordinates, queue/event artifact-count disagreement, and source changes fail closed. The route grants no start, resume, approval, provider, publication, delivery, or canonicalization authority.
