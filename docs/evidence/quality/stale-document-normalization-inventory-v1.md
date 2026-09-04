# Stale document normalization inventory v1

Status: `observed`

As of: 2026-09-04

## Observation boundary

This inventory binds the read-only observation at task-base revision
`0494f2cf768d9fe65339cf8627a84af9f2476c7e`. No normalization provider was invoked, no
candidate was created, and no governed document bytes or lifecycle records were changed.

`lervo knowledge lint --json` was valid with 529 checked concepts and 31
`document_normalization_stale` warnings. Direct lifecycle inspection reported 522 eligible
documents, 434 current documents, and 88 pending documents. The pending set comprised the 31
warning-producing stale families below and 57 documents without current normalization evidence.

The 31 warning-producing records share these properties:

- schema version 2;
- reviewer-owned bytes with the `reviewed_exact` rewrite policy;
- Codex compiler provenance;
- one source and one output at the same path; and
- no portable-skill resource bindings.

An additional historical Claude record for the root `README.md` is stale. The root README is not
an eligible v1 normalization source, and lint intentionally suppresses that historical warning. It
is not counted in the 31 families or the 88 pending eligible documents.

## Classification method

For every warned record, the recorded output hash was located in Git history and compared with the
task-base revision. The table uses repository-unique abbreviated baseline commits and Git line
deltas from the matching reviewed bytes.

- `R` (reference repair): every changed hunk only updates a backtick-delimited repository path.
- `L` (localized evolution): one later commit changed at most 20 lines and the change is not only a
  reference repair.
- `C` (compound evolution): more than one later commit touched the document or more than 20 lines
  changed.

These classes estimate review breadth. They do not prove semantic equivalence and do not grant
write authority.

## Reference-repair families

Five families contain 18,888 current source bytes.

| Source                                                                                       | Record                              | Baseline   | Delta   |
| -------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------- |
| `docs/decisions/release/staging/0117-cli-first-publication-stage-only-workflow-candidate.md` | `knormdoc_a59ed3f8fa35f7d2efbd8d12` | `3802b9e5` | `+1/-1` |
| `docs/decisions/release/staging/0118-cli-stage-publication-command-boundary.md`              | `knormdoc_7e27a289eb610eaebd32db24` | `3802b9e5` | `+1/-1` |
| `docs/evidence/search/provider-neutral-grounding-runner-v1.md`                               | `knormdoc_6cada1e8040afdbb121aee8d` | `3aea74cb` | `+1/-1` |
| `docs/roadmap/knowledge/bounded-document-layout.md`                                          | `knormdoc_1eec7c0a4051498d5050d87e` | `592a7d4c` | `+1/-1` |
| `docs/roadmap/onboarding/repository-upgrade.md`                                              | `knormdoc_1b0a8e9761f74fe59c4eade6` | `695c58d6` | `+1/-1` |

## Localized-evolution families

Seventeen families contain 107,194 current source bytes.

| Source                                                                                          | Record                              | Baseline   | Delta    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | -------- |
| `apps/cli/README.md`                                                                            | `knormdoc_302242c5429f3b1432be1e7a` | `ee0de4df` | `+2/-0`  |
| `docs/architecture/search-and-context.md`                                                       | `knormdoc_dc99395e3884be6f899e3206` | `ee840e5d` | `+9/-2`  |
| `docs/decisions/coordination/remote-control/0149-owner-only-loopback-hub-runtime.md`            | `knormdoc_365d206f631b4e3b8e59a569` | `3802b9e5` | `+5/-3`  |
| `docs/decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md`  | `knormdoc_ebb11101bcd9698bbfd5da3f` | `41d550fe` | `+2/-2`  |
| `docs/decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md`        | `knormdoc_64f84a9083cb50cdf287ed36` | `777d1b05` | `+1/-1`  |
| `docs/decisions/execution/providers/0208-additive-terminal-observation-schema-compatibility.md` | `knormdoc_cb7e038d9f966408e79d19a7` | `695c58d6` | `+2/-2`  |
| `docs/decisions/index.md`                                                                       | `knormdoc_805186672ad78223a073360d` | `3802b9e5` | `+1/-0`  |
| `docs/decisions/operations/services/0164-user-runtime-service-management-boundary.md`           | `knormdoc_e351c68e59e43cb6b27b196f` | `695c58d6` | `+3/-1`  |
| `docs/decisions/operations/services/0165-runtime-readiness-and-preflight-boundary.md`           | `knormdoc_1ef1934187bf33bea32c5f97` | `3802b9e5` | `+13/-2` |
| `docs/decisions/operations/services/0202-repository-node-fleet-identity-and-registry.md`        | `knormdoc_11d3305b99a619e398f3f0b8` | `695c58d6` | `+5/-0`  |
| `docs/distribution/cli-version-management.md`                                                   | `knormdoc_e52e451a0485438d978a732f` | `ee840e5d` | `+1/-1`  |
| `docs/distribution/node-runtime-distribution.md`                                                | `knormdoc_a3729383bc4eb6458ed4fd2d` | `ee840e5d` | `+1/-1`  |
| `docs/roadmap/coordination/repository-node-fleet.md`                                            | `knormdoc_5393d002c9db71102287f269` | `695c58d6` | `+1/-0`  |
| `docs/roadmap/natural-language-grounding-quality.md`                                            | `knormdoc_d4e10becea48a5058d7e616e` | `777d1b05` | `+3/-0`  |
| `docs/specifications/execution/state-lifecycle.md`                                              | `knormdoc_0aa56e2d2611bf728d465044` | `d19b6767` | `+6/-0`  |
| `docs/specs/repository-knowledge-compilation.md`                                                | `knormdoc_20f2e8a41bb321ff2bbbc281` | `fe7d3b39` | `+7/-0`  |
| `docs/specs/repository-knowledge-lifecycle-convergence.md`                                      | `knormdoc_271076796b6f964d36021d45` | `fe7d3b39` | `+6/-0`  |

## Compound-evolution families

Nine families contain 107,113 current source bytes.

| Source                                                                 | Record                              | Baseline   | Delta     | Later commits |
| ---------------------------------------------------------------------- | ----------------------------------- | ---------- | --------- | ------------- |
| `docs/architecture/system.md`                                          | `knormdoc_7599fc373d0a77c092a9928a` | `fb9f94be` | `+38/-6`  | 10            |
| `docs/decisions/distribution/0088-packed-cli-consumer-installation.md` | `knormdoc_6c917d185b83ece608413049` | `3802b9e5` | `+14/-2`  | 2             |
| `docs/distribution/hub-runtime-distribution.md`                        | `knormdoc_f345a72156c149d4f470eb5d` | `ee840e5d` | `+3/-1`   | 2             |
| `docs/product/vision.md`                                               | `knormdoc_1cc558d924d7390404753fc3` | `695c58d6` | `+14/-0`  | 2             |
| `docs/roadmap/v0.md`                                                   | `knormdoc_5865863a3e36bbeff42db9a1` | `ee840e5d` | `+6/-0`   | 3             |
| `docs/specifications/coordination/hub-and-node.md`                     | `knormdoc_3c912d04c2ca0c1f8fad5f04` | `3aea74cb` | `+19/-0`  | 2             |
| `docs/specifications/execution.md`                                     | `knormdoc_f9dce613e617ba4c0dd4f0cc` | `ee840e5d` | `+53/-28` | 9             |
| `docs/specifications/execution/events-and-privacy.md`                  | `knormdoc_7a56dc7b99a1c736fe34b478` | `fb9f94be` | `+138/-2` | 12            |
| `docs/specs/repository-development-pattern-lifecycle.md`               | `knormdoc_f5e0b133b24b0fdd105ef060` | `fe7d3b39` | `+15/-0`  | 2             |

## Operational finding

The warned families contain 233,195 source bytes. The complete pending set at the observation
boundary contains 589,372 bytes. The current normalizer has no source-workset option: one provider
invocation request would select all 88 pending documents and partition them into 45 envelopes, with
at most three envelopes active concurrently.

The provider adapter parses usage for semantic compilation but the document-normalization
interface returns only normalized content. Consequently, the normalization command does not expose
per-envelope or aggregate input, output, cached, or total token usage. Source bytes and envelope
counts are capacity evidence, not token measurements.

Immediate provider execution would therefore widen the reviewed 31-family task to 57 unrelated
new documents and would not provide the requested operation-level token accounting. The bounded
remediation plan is maintained in
[Document normalization evidence renewal](../../roadmap/knowledge/document-normalization-renewal.md).

## Non-claims

- A stale record does not mean the current Markdown is incorrect, unsearchable, or absent from
  structural compilation.
- Small line deltas do not establish low semantic risk.
- Codex provenance does not prove Codex is the best provider for a replacement candidate.
- Provider agreement would not prove correctness or semantic preservation.
- This inventory does not authorize rewriting, approving, or retiring any lifecycle record.
