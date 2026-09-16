# Pre-turn settlement and budget incident

## Canonical settlement

On 2026-09-14 KST, correction run `run_f91fb364af05def51ad2af41315848c1` gained one canonical `run.failed` at sequence 11337 after exact-prefix, boot-transition, and owner-fence proof. Its original five events remain unchanged. The result is `known_safe_failure`; no adapter start or provider usage receipt exists for that run.

A real owner judgement completed at sequence 11372, raising observed workstream usage from 1,396,782 to 1,460,665 tokens. With the installed maximum of two attempts and one recovery decision used, the owner recorded attention at sequence 11375 with `retry_budget_requires_resolution`; it did not rerun the research worker.

## Mandate 13 and charged overuse

Workstream revision 541 required mandate succession. Version 13 retained the exact version-12 paths, staff, actions, two-attempt limit, and 1,500,000-token aggregate ceiling, changing only version and validity timestamps.

- Installation sequence: 11378.
- Mandate hash: `sha256:607940f272af8e1c19e78f9075499e5ca8440328520951b3f9a3fbc4774412f2`.
- Review hash: `sha256:592e8b7666a74343a2e927ac5052ff331008b4acdb9e1da9f8a2aab376c2dd55`.

Corrected Node bundle `sha256:715386257e59e7ac277632ec761e6e257c4d3a0e88f38931eb5c00070d7eb26d` was activated with the version-13 private configuration. Renewal changed the owner-attention basis, prompting another owner reasoning call. The call reported 63,536 provider tokens at sequence 11405 and completed at sequence 11407. Observed aggregate reached **1,524,201 tokens**, exceeding the existing ceiling by 24,201. No research worker was dispatched by this call.

The service was stopped at 2026-09-13 17:11 UTC before another call started, with `ActiveState=inactive`, `MainPID=0`, and zero automatic restarts.

## Admission correction and remaining gate

The admission gap was an owner reasoning reservation of 1,000 tokens despite a mandate per-attempt ceiling of 100,000. Only 39,335 tokens remained in the aggregate budget; the understated reservation admitted a call that used 63,536.

The source correction reserves at least the full per-attempt ceiling for every new owner reasoning plan; runtime validates the same amount before invocation. An admission ceiling cannot physically truncate an external provider turn, so reported overuse remains charged.

Seven focused tests passed on each Mac and WSL. Mac type checking, quality, document lifecycle, and task-base release-completion checks passed. WSL build, quality, document lifecycle, and task-base release-completion checks passed. Both source trees matched at `61b8c5565607a52cddddeb2954e585ae34777228`.

Corrected WSL bundle `sha256:4c8f90695c1953aad9e24dfc171f09e28b4260ab1a48250b26eaa4291f67618d` is staged inactive. No expanded mandate is installed. The separate version-14 candidate would increase maximum assignment attempts from two to three and the aggregate ceiling from 1,500,000 to 2,000,000 while preserving other scope; it requires the appointing authority's explicit review.

Installed `/goal` invocation, accepted result, and Discord delivery remain open.
