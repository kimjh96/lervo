# Managed linked-evidence canary v7 terminal report

Status: `terminally_stopped`
Date: 2026-08-29

V7 bound exact manifest `sha256:e4b76d1173cb819e0105644cf67a1724b98264ac70c23f7ac566aaa16d43ba4e` and persisted ordinal 1 before invoking Codex adapter start. The adapter rejected the run synchronously because the `developer` role authorizes filesystem writes, while the canary sandbox is read-only and approvals are disabled.

The start wrapper recorded one provider-start invocation, but failure occurred before provider client creation and emitted no usage. This attempted boundary call is not evidence of a model turn, token consumption, or billing. No selection adapter or selection call was created, no Claude run began, and no repository write was authorized.

V7 is not retried. V8 uses the repository-defined machine-facing `canary-researcher` role, which denies writes and every other effect capability while preserving the native signed-in provider path. No API key is introduced.

## Evidence

- Prepared manifest digest: `sha256:e4b76d1173cb819e0105644cf67a1724b98264ac70c23f7ac566aaa16d43ba4e`
- Failure observation file digest: `sha256:d7c679111af964a6277e2df52f6f9798222fab09d26b233af79a1147b91ec821`
- Completed model runs: 0
- Adapter creations: 1
- Provider-start invocations: 1
- Provider clients created: 0
- Provider usage observations: 0
- Selection calls: 0
- Claude runs: 0

## References

- [V7 role decision](../../../decisions/search/activation/provider-shadow-structured/0286-use-machine-output-role-for-key-free-managed-canary-v7.md)
- [V8 correction decision](../../../decisions/search/activation/provider-shadow-structured/0287-use-read-only-machine-role-for-key-free-managed-canary-v8.md)
