# Staged evidence selection v7

Status: `observed_rejected`
Observation date: 2026-08-28

## Question

Can two independent stages—exact source selection followed by answer composition using only selected bodies—repair source preservation and no-hit reliability while keeping selection, loading and injection, final output reference, and provider use distinct?

## Acceptance contract

V7 preserved the human-reviewed v6 ground truth and had to:

- pass all three repetitions for at least six of eight cases;
- be non-inferior to contemporaneous model direct in pass count and exact expected-path recall;
- use at most 85% of direct observed total tokens and 95% of direct wall duration, with complete usage in both arms;
- have no worse no-hit p95 duration or latency standard deviation than direct;
- produce no assisted-arm provider execution, selection, coverage, source-marker, or response-contract failures; and
- drop no relevant lexical recommendation, deterministic coverage source, or selected no-hit candidate.

Any failure rejected v7. Stage-one selection, harness loading and injection, and stage-two output reference are separate observations. None proves attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use. Token usage is a provider observation, not billed cost.

## Protocol

The accepted run used `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Eight cases ran three times per arm in independent sessions with rotating arm order. Model direct scheduled 24 calls. V7 scheduled 48: stage one returned only exact selection coordinates; the harness loaded only recognized source bodies; stage two returned bounded Korean prose plus exact final evidence references.

Lexical-hit selection used exact `lervo-e4` coordinates attached to the unchanged v6 top-three lexical and deterministic core-and-term bodies. Lexical no-hits used a bounded path-title catalog with opaque selection coordinates and no bodies; stage two received only the selected bodies. Returned paths came only from exact stage-two references.

The English-dominant sanitized corpus excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and evaluated search decisions. The run binds:

- suite digest: `sha256:e9b60b5ab7e66104dd1ca7fbd21d1db33b4496e632737afc2a9e05481fe7865b`;
- combined protocol digest: `sha256:d2d74a41841ab4f16b8b98481046caa1118f975d89c8f88357d73db51000dfcf`;
- selection protocol digest: `sha256:01c8d6d08bd900252655779e16dcc850feedf9083fbaa384f9f493ca06d004f1`;
- answer protocol digest: `sha256:483b068f173dfa4934712d1283e55d0b317601011aa07dc24d8ba62d82a05729`;
- no-hit catalog digest: `sha256:31ce193f17d6c49c27182be85c2c8e8b5535a118f63cd3775d78eee1f8f2e960` over 284 sources and 54,303 bytes;
- corpus digest: `sha256:96acb19f94eb6b402fc52c71a4a96e89346beb0bbcc5fd5fe9f4e0112ff4999d`;
- repository revision: `46b36f1a192c3f6e19baa4da5d803900a2a84279`;
- working-tree status digest: `sha256:1ad28ce358cc84f7032fd1afa4bc7b6db893c7e690dc3be93c9be8a1b55ad96c`; and
- raw operator-only report digest: `sha256:00f9695876c3af07fbb6a1d1ad9e7357e823dc563680a76ad9b97ba742c7a049`.

The raw report was mode `0600`, stored outside the repository, and moved to recoverable system Trash after this redacted observation was produced. A prior full run with raw digest `sha256:3ee12f1e606defdea96f3cc75504631bfd393800d81a956aa7ae4f02734c9684` was discarded before adoption because the initial scorer could collapse duplicate or non-standalone E4 output into one recognized coordinate. After correcting the exact-marker scorer, focused tests and the dry-run passed, and the full comparison was rerun. The discarded report remains separately recoverable in Trash and contributes no metrics below. This document contains no source bodies, absolute paths, markers, provider turn identifiers, or answer prose.

## Result

V7 failed six of fifteen criteria: repeatability, pass-count non-inferiority, recall non-inferiority, source-marker and response contracts, and deterministic coverage-source preservation. It passed token, duration, both no-hit latency, selection, coverage, recommendation, no-hit-candidate, and provider-execution criteria.

| Metric | Model direct | Staged evidence v7 |
| --- | ---: | ---: |
| Grounded-answer verdicts passing | 17/24 | 16/24 |
| Cases passing all three repetitions | 5/8 | 5/8 |
| Mean expected-path recall | 83.33% | 79.17% |
| Mean returned-path precision | 30.19% | 68.75% |
| Wall duration | 1,216.537 s | 650.572 s |
| Mean duration | 50.689 s | 27.107 s |
| Duration p50 | 40.888 s | 23.895 s |
| Duration p95 | 84.823 s | 41.893 s |
| No-hit duration p50 | 38.883 s | 20.354 s |
| No-hit duration p95 | 47.985 s | 24.450 s |
| No-hit latency standard deviation | 6.577 s | 1.603 s |
| Completed repository commands | 80 | 0 |
| Observed total tokens | 3,457,583 over 24 complete observations | 1,410,248 over 24 complete observations |
| Provider execution failures | 0 | 0 |
| Selection-contract failures | N/A | 0 |
| Coverage-contract failures | N/A | 0 |
| Source-marker-contract failures | N/A | 1 |
| Response-contract failures | N/A | 1 |
| Exact final evidence references | N/A | 46 |
| Dropped relevant recommendations | N/A | 0 |
| Dropped relevant deterministic sources | N/A | 2 |
| Dropped relevant no-hit candidates | N/A | 0 |

V7 used 59.21% fewer observed tokens and 46.52% less wall duration. Complete usage observations made both ratios admissible. It improved no-hit p95 by 49.05% and no-hit latency standard deviation by 75.62%.

## Case diagnosis

- Ordinary release lookup: direct passed 3/3; v7 passed 0/3 and returned only one of two expected sources every time.
- Terse release: direct passed 0/3 despite 100% expected-path recall because its returned sets missed the scoring envelope; v7 passed 0/3 with 50.00% mean recall and one forbidden final source marker.
- Historical hybrid-search rationale: both arms passed 3/3.
- Node-fleet impact: both arms passed 3/3.
- Human-reviewed fuzzy-merge boundary: v7 passed 3/3 with 100% recall; direct passed 2/3 with 66.67% mean recall.
- User-owned-block boundary: direct passed 0/3; v7 passed 1/3 and twice omitted the selected and loaded execution specification from its final references.
- Both no-hit continuation phrasings: both arms passed 3/3. Every v7 selection resolved to the expected continuation ADR, loaded successfully, and produced an exact final reference.

The staged protocol repaired the observable no-hit chain skipped by v6: selection, load and injection, and final reference succeeded in all six no-hit observations. Final evidence preservation remained weak. V7 selected and loaded the execution specification before omitting it twice, and never received the missing canonical CLI version-management source because unchanged v6 coverage did not supply it. Exact-marker hardening exposed one forbidden reference without changing marker-derived scoring. Stage separation improved diagnosis and no-hit behavior without meeting aggregate quality.

## Decision

Reject staged evidence selection v7 and do not activate it in managed execution. Keep `lexical-v1` operational. Retain the v7 runner, suite, exact stage contracts, and redacted observation as reproducible negative evidence.

Any later candidate requires separately reviewed pre-registration. It must not treat selected, loaded, injected, or referenced bodies as provider use, add fixture-specific routing, relax thresholds, infer completeness from confidence, or silently activate managed provider calls.

See [ADR-0245](../../decisions/search/0245-evaluate-staged-evidence-selection-v7.md), the [v6 observation](marker-derived-paths-v6.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
