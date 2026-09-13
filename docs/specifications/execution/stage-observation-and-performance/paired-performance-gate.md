# Paired performance gate and verification

## Protocol

The provider-free version 1 protocol runs 100 alternating baseline/candidate pairs for each declared profile:

- Small cold prompt.
- Small warm prompt.
- Medium warm prompt.
- Large warm prompt.
- Small warm Stop.
- Four concurrent medium warm prompts.

Baseline disables only stage recording. Both arms start each pair from the same repository snapshot. Warm templates receive one successful unmeasured prompt before cloning. Stop preparation occurs outside the measured interval with recording disabled for both arms. Concurrent hooks use independent repositories.

## Report contract

Every report binds:

- Exact source-byte digest and protocol digest.
- Privacy-safe environment profiles and hashes.
- Population, nearest-rank p50 and p95, eligible p99, and maximum.
- Process CPU, process peak RSS, failure and timeout rates, stage distributions, and signed paired overhead.
- Retrieval, lifecycle, and privacy correctness.

The source digest excludes only the generated report and rebuildable `docs/knowledge/` projections. Any other source change makes the report stale.

Each profile binds one measurement-environment assessment derived only from its baseline duration distribution. `measurementEnvironment.status` is `unstable` when baseline p95 exceeds twice baseline p50 or when positive baseline p95 accompanies zero p50. The report retains the nullable p95-to-p50 ratio, fixed 20,000 basis-point boundary, and exact `baseline_p95_tail_inflation_exceeded` reason. These aggregate fields share the duration distribution's privacy boundary and add no host-process details.

Generated JSON is canonical aggregate evidence. Its Markdown companion interprets the bound observation without duplicating mutable measurements. Stage evidence proves elapsed Lervo work only; it does not prove provider acceptance, model attention, learning, semantic use, or task correctness.

## Acceptance

Version 1 has no exception path. `budgetStatus` retains the existing numerical and correctness decision. `acceptanceStatus` additionally requires a stable measurement environment. `allProfilesPassed` requires every acceptance status to pass.

Every profile must satisfy all gates:

- Every sample is below 30 seconds.
- Prompt p95 is at most 15 seconds.
- Prompt p99, when supported by the population, is at most 24 seconds.
- Stop p95 is at most 5 seconds.
- Candidate p95 exceeds baseline p95 by no more than the greater of 10 percent or 25 milliseconds.
- Neither arm has an execution, timeout, retrieval, lifecycle, or privacy failure.

An unstable environment adds `measurement_environment_unstable` without deleting a simultaneous `p95_regression_exceeded` or any other failure. The runner performs one complete observation without automatic retry, filtering, or result selection. An unstable report exits unsuccessfully and cannot enter foundation readiness.

## Verification

```bash
pnpm foundation:performance:run
pnpm foundation:performance:check
```

The run command rebuilds the harness and replaces the generated report. The check validates structure, populations, statistics, decisions, correctness, privacy, report identity, protocol digest, current source digest, and absence of exceptions.
