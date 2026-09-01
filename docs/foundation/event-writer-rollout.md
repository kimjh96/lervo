# Event writer reader-first rollout

Status: `active`

As of: 2026-09-01

## Safety boundary

Envelope version 2 writing is repository-local, off by default, and selected only by the
Lervo-managed `.lervo/data/event-contract.json` coordinate. Missing coordinates mean
version 1. Activation changes future writes only; it never rewrites event history.

Every process that can read the repository event chain must run a version 2-capable
reader before activation. After any version 2 event exists, rolling the writer back to
version 1 does not make a version 1-only reader safe because mixed history remains.
Reader releases therefore stay version 2-capable through writer rollback.

Hub-enabled repositories currently fail closed with
`reader_inventory_authority_unavailable`. The local CLI cannot prove the complete
identity-bound Node and Hub reader inventory, so it cannot authorize distributed
activation. Do not disable Hub synchronization to bypass this gate.

## Local-only activation

1. Stop repository writers and make the existing event database and writer coordinate,
   if present, recoverable through the repository's normal backup procedure.
2. Upgrade every local reader and verify `lervo trace --capabilities --json` advertises
   readable event schema versions `[1, 2]`.
3. Capture the bounded, secret-free local evidence once:

   ```text
   lervo event-contract evidence --json > event-reader-evidence.json
   ```

4. Produce a read-only plan and inspect its `status`, blockers, current hash, desired
   hash, and exact `planId`:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --json
   ```

5. Apply only that exact current plan ID with the same evidence bytes:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --apply <plan-id> --json
   ```

6. Verify `lervo event-contract status --json`, append through an ordinary managed path,
   and replay the complete mixed chain before restarting concurrent writers.

Evidence creation, planning, and apply are separate operations. A changed manifest,
coordinate, capability bundle, or evidence file makes the plan stale before mutation.

## Writer rollback

Use the same version 2-capable release to plan and apply a return to version 1 writing:

```text
lervo event-contract rollback --json
lervo event-contract rollback --apply <plan-id> --json
```

Verify that status selects version 1 and replay the complete mixed chain. Keep all
readers version 2-capable. Rollback proves only the future writer selection; it does not
remove version 2 events, reverse another deployment, or prove Node and Hub health.

Before writer activation, a failed reader deployment may be rolled back to the prior
version 1-only release because no version 2 history exists. After activation, deploy a
fixed version 2-capable reader instead.

## Interrupted apply

A pending owner-only transaction blocks status, new plans, and ordinary project storage.
Run explicit recovery:

```text
lervo event-contract recover --json
```

Recovery reports exact `completed`, exact `rolled_back`, or fails with
`event_writer_recovery_required`. It never guesses from a missing response. Run status
and full-chain replay after recovery before resuming writers.
