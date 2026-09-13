# Interrupted apply

A pending owner-only transaction blocks status, new plans, and ordinary project storage. Run explicit recovery:

```text
lervo event-contract recover --json
```

Recovery reports exact `completed`, exact `rolled_back`, or fails with `event_writer_recovery_required`. It never guesses from a missing response. Before resuming writers, run status and replay the full chain.
