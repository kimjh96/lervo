# Automatic activation

`lervo upgrade --apply --approval <plan-id>` collects reader evidence, plans, and applies the exact current plan for event schema 4 through its `event_writer` stage ([ADR-0470](../../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)).

Before applying, it writes a backup to `.lervo/data/event-writer-backups/schema-4/`: a consistent `VACUUM INTO` copy of `events.sqlite`, the previous `event-contract.json` when present, and `backup.json`. The copy remains consistent while other processes append, so writers need not stop.

Activation is refused while the generated terminal hook runtime is stale (`terminal_hook_reader_stale`), because that runtime embeds its own reader.

The host knowledge resident, `lervo init`, and `lervo repository register --write` run the same activation for checkouts whose only reader is the local runtime.
