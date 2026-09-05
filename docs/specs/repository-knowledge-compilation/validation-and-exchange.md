# Exchange, Failures, and Acceptance

## Exchange

OKF v0.2 export creates a content-addressed, schema-versioned bundle. Import preserves unknown metadata and original bundle bytes but maps external verification to local `unreviewed`.

Hub document sharing uses structured shared-context coordinates plus CAS bytes; repository knowledge exchange uses OKF rather than an opaque upload. Capability packages use their separate kind-tagged envelope. A clone or another installation can lint, query, and re-export without a Hub.

## Failure meaning

| Failure | Meaning |
| --- | --- |
| source unsafe | Path, symlink, race, or source contract prevents safe reading. |
| limit exceeded | File, byte, unit, nesting, response, or navigation bound exceeded. |
| plan stale | Source, policy, registry, approval, or target changed. |
| reconciliation conflict | Ownership or identity cannot be resolved automatically. |
| approval required | User-byte or conflict operation lacks exact authorization. |
| apply failed | Commit failed and pre-event bytes were restored. |
| recovery required | Interrupted or post-commit transaction requires recovery. |
| lint failed | Publications, sidecars, manifests, or bridges disagree. |

## Acceptance

1. Migration, not initialization, gives an undocumented repository English README and AGENTS entrypoints and a cited bundle.
2. Structural routing precedes exact per-source-approved rewrites from stored candidates.
3. Coverage includes code, configuration, tests, evidence, log metadata, and unsupported files.
4. Large categories shard below both bounds; owned obsolete pages disappear safely.
5. Malicious text cannot trigger tools, network, writes, or provider customization.
6. Codex and Claude pass the same no-capability contract.
7. Semantic changes require reconciliation and human review.
8. Apply and recovery pass failure injection.
9. Lint succeeds and immediate replan has no changed operations.
10. A clean clone reproduces tracked knowledge without a Hub.
11. Ambiguous or unclassified ADRs fail closed, and leaves respect bounds.
12. Eligible Markdown, including portable skills, enters the language and format lifecycle; immediate replan is current, while changed resources become stale.
13. Fuzzy cross-provider candidates fail closed on weak or ambiguous matches and cannot materialize both pair members.
14. AGENTS bytes remain constant as canonical instructions and skills grow; legacy route projections migrate once and replan current.
15. One-shot durable-rule intake materializes only an explicit, additive, low-risk repository directive with a complete conflict catalog and retains no prompt prose or lexical authority mapping.
16. A fresh provider session retrieves a matching canonical instruction from task-purpose and target-path context while suppressing substantially weaker incidental document matches.
17. A completed result creates a portable-skill candidate only from at least two independently grouped current sources and distinct passed verification runs; its bounded instructions, resources, and execution contracts remain disabled and unmaterialized until exact review and promotion.
