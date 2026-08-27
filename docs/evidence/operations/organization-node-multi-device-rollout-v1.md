# Installed organization Node multi-device rollout acceptance v1

Status: `passed`  
Observation date: 2026-08-27

## Question

Do the current organization rollout contracts and installed local adapters preserve the intended three-Node sequence: one canary, deterministic two-Node expansion, a hold on incomplete evidence, and explicit predecessor rollback of only the failed Node?

## Protocol

The acceptance scenario creates three independently enrolled Nodes under one strict-project policy. Each Node has a distinct Node ID, destination, service instance, runtime credential, installed configuration, local rollout plan, and local apply boundary. The fleet plan has a one-Node canary followed by the maximum permitted twofold expansion.

The test uses the public organization deployment contract and installed CLI rollout and rollback adapters. Native service-manager effects are bounded fakes. Filesystem roots, installed configuration binding, executable artifact inspection, local-plan revalidation, apply receipts, and predecessor rollback coordinates still cross production adapter boundaries.

## Result

| Stage | Observed result |
| --- | --- |
| Canary approval and apply | Only the first Node received a forward local apply receipt. |
| Canary observation | Exact target coordinates and complete readiness evaluated to `ready_to_advance`. |
| Expansion | Two distinct installed Node adapters each revalidated and applied their own local plan. |
| Incomplete expansion evidence | One ready and one pending Node evaluated to `hold`; rollback approval was rejected. |
| Failed expansion evidence | Reversing input order produced the same canonical observation; one degraded target evaluated to `rollback_required`. |
| Rollback selection | The ready wave member was rejected; the degraded member produced an exact predecessor-bound plan and receipt. |
| Effect accounting | All three Nodes had one forward apply; only the degraded Node had one rollback effect. |

Focused verification:

```bash
pnpm exec vitest run apps/cli/test/organization-node-rollout-multi-device.test.ts
```

## Claims and limits

This scenario proves deterministic fleet gating and Node-scoped installed transaction composition for the observed three-Node topology. It also proves that a successful per-Node execution receipt does not advance a wave: advancement requires a complete canonical wave observation and separate approval.

It does not prove a live OS service manager, physical machines, Hub transport, signed rollback delivery, durable rollback replay fencing, crash recovery, cross-Node atomicity, unattended automation, or future health. Forward applies are independent Node transactions. Rollback is an explicit programmatic action for one failed Node and does not undo the ready wave member.

## References

- [Organization Node fleet rollout](../../roadmap/operations/organization-node-fleet-rollout.md)
- [ADR-0229](../../decisions/operations/security/0229-organization-node-enrollment-and-gradual-rollout.md)
- [ADR-0232](../../decisions/operations/security/0232-approved-node-rollout-local-transaction.md)
- [ADR-0235](../../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md)
- [Hub and Node coordination](../../specifications/coordination/hub-and-node.md)
