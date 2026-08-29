# Marker-derived repository retrieval v6

Status: `observed_rejected`
Observation date: 2026-08-28

## Question

Can source paths derived only from exact output markers improve deterministic retrieval repeatability while separating response-format failures from retrieval scoring and using human-reviewed fuzzy-merge ground truth?

## Ground-truth review and acceptance contract

Before execution, the user approved one fixture correction: retain hash-bound human resolution ADR-0180, replace exact-merge ADR-0187 with approval-gated fuzzy-merge ADR-0227, and include ADR-0227 in the corpus. The other seven cases remain unchanged. V6 records `human_reviewed` provenance for this eight-case mapping; it neither promotes earlier suites nor establishes production quality.

V6 had to:

- pass all three repetitions for at least six of eight cases;
- be non-inferior to contemporaneous model direct in pass count and exact expected-path recall;
- use at most 85% of direct observed total tokens and 95% of direct wall duration;
- have no worse no-hit p95 duration or latency standard deviation than direct;
- produce no provider execution, coverage, source-marker, or response-contract failures; and
- drop no relevant lexical recommendation, deterministic coverage source, or named no-hit candidate.

Any failure rejected v6. Markers prove observable bounded-output reference only, never attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use. Token usage is a provider observation, not billed cost. Acceptance requires complete observations in both arms.

## Protocol

The accepted run used `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Eight cases ran three times per arm in independent sessions, producing 48 completed turns with rotating arm order.

V6 retained v5's top-three lexical bodies, fixed canonical core, deterministic per-ASCII-term coverage, and no-hit-only catalog. Exact `lervo-e4` comments identified supplied evidence bodies. The no-hit catalog bound every path and first heading to deterministic opaque inspection and source comments. Recognized markers, not provider-written path strings, derived returned paths. Bounded Korean prose replaced JSON; response-format and provider execution failures were scored separately from marker-derived recall.

The English-dominant sanitized corpus excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and evaluated search decisions. The run binds:

- suite digest: `sha256:31c3bd42b8a44ccd1d1955fba7b1190d6645c14da2d75fb1b4f578bc630ee078`;
- protocol digest: `sha256:4a290925dd8cc2b285e76b619ea1f30ec2a785dfb9c9e2640529266c3392c707`;
- no-hit catalog digest: `sha256:11a5c1c73c4d21cbc60bfd0a703b918ba94eb43d8f6b49362bac4b5debb20e5a` over 284 sources and 70,778 bytes;
- corpus digest: `sha256:96acb19f94eb6b402fc52c71a4a96e89346beb0bbcc5fd5fe9f4e0112ff4999d`;
- repository revision: `46b36f1a192c3f6e19baa4da5d803900a2a84279`;
- working-tree status digest: `sha256:f29324ae2c43d96a9280460c2f0a35dfba6da6d26bd186409b365be353ff1601`; and
- raw operator-only report digest: `sha256:bf5ad92bbdc10dcbb04e21c1b4d876c478eae20b2fe3c2fcf408821141c03ae7`.

The raw report was mode `0600`, stored outside the repository, and moved to recoverable system Trash after this redacted observation was produced. A prior full run with raw digest `sha256:8ddd529c0e006e0ca26f673e4b9033a3d657ea904c0690f8d0d7da5fef9ff859` was discarded before interpretation because response failures were also mislabeled as provider failures. It remains separately recoverable in Trash and contributes no metrics below. This document contains no source bodies, absolute paths, markers, provider turn identifiers, or answer prose.

## Result

V6 failed eight of fourteen criteria: repeatability, pass-count non-inferiority, recall non-inferiority, no-hit latency standard deviation, zero coverage failures, zero response failures, recommendation preservation, and deterministic coverage-source preservation. It passed token, duration, no-hit p95, source-marker, no-hit-candidate, and provider-execution criteria.

| Metric | Model direct | Marker-derived v6 |
| --- | ---: | ---: |
| Grounded-answer verdicts passing | 19/24 | 13/24 |
| Cases passing all three repetitions | 6/8 | 3/8 |
| Mean expected-path recall | 87.50% | 64.58% |
| Mean returned-path precision | 34.78% | 53.13% |
| Wall duration | 1,096.041 s | 528.928 s |
| Mean duration | 45.668 s | 22.039 s |
| Duration p50 | 41.561 s | 19.946 s |
| Duration p95 | 67.646 s | 43.499 s |
| No-hit duration p50 | 35.218 s | 22.827 s |
| No-hit duration p95 | 49.325 s | 43.499 s |
| No-hit latency standard deviation | 8.716 s | 9.164 s |
| Completed repository commands | 81 | 6 |
| Observed total tokens | 3,048,859 over 24 turns | 1,415,252 over 24 turns |
| Provider execution failures | 0 | 0 |
| Coverage-contract failures | N/A | 3 |
| Source-marker-contract failures | N/A | 0 |
| Response-contract failures | N/A | 3 |
| Exact output evidence references | N/A | 51 |
| Dropped relevant recommendations | N/A | 1 |
| Dropped relevant deterministic sources | N/A | 2 |
| Dropped relevant no-hit candidates | N/A | 0 |

V6 used 53.58% fewer observed tokens and 51.74% less wall duration. It improved no-hit p95 by 11.81%, but no-hit latency standard deviation was 5.14% worse. Complete usage observations made the resource ratios admissible. The source-marker contract passed every turn. The three response failures were missing bounded inspection candidates in no-hit cases, not malformed JSON or provider execution failures.

## Case diagnosis

- Ordinary release lookup: direct passed 3/3; v6 passed 0/3 and returned only one of two expected sources each time.
- Terse release: direct passed 1/3; v6 passed 0/3, averaged 33.33% recall, and dropped the relevant reviewed release-preparation recommendation once.
- Historical hybrid-search rationale: both arms passed 3/3.
- Node-fleet impact: both arms passed 3/3.
- Human-reviewed fuzzy-merge boundary: both arms passed 3/3 with 100% recall; the approved fixture correction is stable in this run.
- User-owned-block boundary: direct passed 0/3; v6 passed 1/3 and dropped the injected execution specification twice.
- First no-hit continuation phrasing: direct passed 3/3; v6 passed 1/3 and omitted inspection candidates twice.
- Second no-hit continuation phrasing: direct passed 3/3; v6 passed 2/3 and omitted inspection candidates once.

The experiment separates two findings. Exact source markers were technically reliable: every recognized supplied-source marker resolved without mismatch, and marker-derived scoring remained available during response-format failures. Source selection remained unreliable: v6 omitted known relevant release and execution sources and often skipped no-hit inspection. Removing JSON did not establish the required completeness or repeatability.

## Decision

Reject marker-derived paths v6 and do not activate it in managed execution. Keep `lexical-v1` operational. Retain the human-reviewed ground-truth correction, v6 runner, suite, and redacted observation as reproducible evidence.

Any later candidate requires separately reviewed pre-registration. It must not treat markers as understanding or internal use, add fixture-specific routing, relax thresholds, infer completeness from confidence, or silently activate managed provider calls.

See [ADR-0244](../../decisions/search/0244-evaluate-marker-derived-source-paths-v6.md), the [v5 observation](reference-marker-assisted-v5.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
