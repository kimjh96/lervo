# ADR-0650: Raise the event writer target to schema 16 after its readers

Status: `accepted`
Decision date: 2026-11-27
Amends: [ADR-0470](../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) (the event writer stage's target, and which published hook runtime counts as a reader)
Related: [ADR-0332](../operations/trace/0332-authoritative-distributed-event-reader-inventory.md), [ADR-0575](0575-follow-published-releases-on-every-host.md), [ADR-0645](../execution/providers/hooks/0645-answer-an-unserved-prompt-from-the-cached-base.md), [ADR-0641](../coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md), [ADR-0648](../coordination/conversations/agent-organization/0648-attest-a-conversation-note-by-its-delivery-receipt.md), [event envelope compatibility](../../specifications/execution/events-and-privacy/event-envelope-compatibility.md)
Amended by: [ADR-0651](../operations/storage/0651-prune-superseded-event-writer-backups.md) (the backup pruning follow-up)

## Context

Since ADR-0645 (CLI 0.61.0), `lervo upgrade` has activated writer schema 14. Readers for schemas 15 and 16 shipped in CLI 0.62.0:

- Schema 15 adds the room events and the owner rules counted on `terminal.context.prepared`.
- Schema 16 adds `assignment.lease.widened`, `assignment.claim.refused`, and `conversation_note` promotions.

Every reader takes its versions from `readableEventSchemaVersions` in `@lervo/event-contract`: the CLI, the Node's health report, the Hub's `/v1/health/capabilities`, and the terminal hook runtime. Each writer for 15 or 16 checks the repository's selected writer version, so none records anything while the target stays at 14.

A read-only check on 2026-11-27 found every reader ready:

- the WSL Hub (release 0.62.0) reports versions 1 through 16;
- the Mac and WSL CLIs are 0.64.0, and so are the publishers of both hosts' hook runtime pointers;
- the registered repository Node reports runtime 0.64.0.

ADR-0470's hook reader check accepts any valid runtime that another live install published. It never asks which release that install is. Suppose an upgrade runs from an install that is not the host's publisher, such as a source build, and an older install published the pointer. The check passes, and that host's hooks then meet events their reader rejects.

## Decision

1. **The target is `coordinationEventSchemaVersion`, 16.** `lervo upgrade`, the host resident, and onboarding converge on it. Every configured reader must report versions 1 through 16, and the backup goes to `.lervo/data/event-writer-backups/schema-16/`.
2. **The hook runtime must come from an install at least as new as the activating CLI.** The published runtime counts as a reader when it is this CLI's own runtime (the same content hash). It also counts when its publisher is an `@lervo/cli` install at least as new as the CLI that activates. A runtime from an older install, or from a publisher whose version cannot be read, is `terminal_hook_reader_stale`. The remedy adds one step: run this release's installed `lervo` once so it publishes its own runtime. The resident's retry already waits on the pointer file, so the next publish clears the hold.
3. **Node and Hub keep their rule.** A reader that does not list 1 through 16 is `event_writer_activation_blocked`. A stale Node or an unreachable Hub keeps its own code. Every blocker returns before the backup, a failed backup activates nothing, and the coordinate changes in one transaction. A host that cannot read 16 is held, never partly written.
4. **Coordination stays gated separately.** `COORDINATION_STAGE_ENABLED` stays false, so claims, reconciliation, and the coordination stage of `lervo workspace start` record nothing. A raised target alone does not open them.

### Train-20 activation plan

1. **Readers.** Readers are already deployed. The Hub has read 1 through 16 since train 17, and every 0.62.0 or later CLI, Node, and hook runtime reads 16. Re-read the Hub capability endpoint before cutting the release.
2. **Pause.** Run `lervo host upgrade --follow --pause` on the Mac and on WSL before publication, so the followers ([ADR-0575](0575-follow-published-releases-on-every-host.md)) do not activate the fleet first.
3. **Mac canary.** Install the release on the Mac and run `lervo upgrade --apply --json` in the Mac lervo checkout, whose only reader is the local runtime. It passes when all of these hold:
   - `event_writer` applies;
   - `lervo event-contract status --json` selects 16;
   - `schema-16/backup.json` exists;
   - a prompt and a Stop in that checkout still record `terminal.context.prepared` and `terminal.turn.observed`.
4. **Fleet.** Run `lervo host upgrade --follow --resume` on both hosts. Each follower runs `lervo upgrade` in every registered repository. A repository whose Node and Hub are readers activates only with Node health younger than two minutes and the Hub's identity-bound capability report.
5. **Rollback.** Before activating, `lervo upgrade` writes `.lervo/data/event-writer-backups/schema-16/`. It holds a `VACUUM INTO` copy of `events.sqlite`, the previous `event-contract.json` (which selects 14), and `backup.json`. To stop writing 15 and 16, restore that `event-contract.json`; this is the only supported way. In order:
   1. Copy `schema-16/` outside `.lervo/data` before anything else touches the store. The next activation would replace it: the backup step removes the old directory and renames a new one into its place.
   2. Run `lervo host upgrade --follow --pause` on the host. Run no `lervo upgrade` until the cause is fixed, because the next pass activates 16 again.
   3. Copy the saved `event-contract.json` back to `.lervo/data/event-contract.json`, then restart the host resident and any Node or other long-running Lervo process. A process keeps writing at the version it opened the store with until it reopens it.
   4. Check that `lervo event-contract status --json` selects 14. History written at 15 and 16 stays, and every 0.62.0 or later reader reads it.

   Do not use `lervo event-contract rollback` for this. It always returns the writer to version 1, which is below the knowledge resident's admission at 4. On a local-only checkout the resident's next scan then activates 16 again and takes a fresh backup, replacing the copy that selects 14. On a checkout with a Node and the Hub, the resident holds with `event_writer_distributed_activation_required`, and background knowledge stops. Replace `events.sqlite` from the copy only when the store itself is damaged, because the copy lacks every event recorded after activation.

## Consequences

- At 16, the CLI's lease event recorder (claims and their reconciliation) can write, but only behind the closed coordination gate, so it records nothing in this release.
- At 15, no writer is on `main` yet. The room writer of the peer change (pull request 598) records as soon as it lands, because its gate is the writer version.
- No `conversation_note` writer exists yet. ADR-0648's attestation is in place for it.
- A host whose runtime an older install published holds activation until this release's CLI publishes its runtime. Any ordinary `lervo` invocation does so.
- Every activation keeps a full `VACUUM INTO` copy of the event store per target version. The Mac lervo checkout already holds about 650 MB in `schema-5` through `schema-14`, and `schema-16` adds about 125 MB. Pruning old backups is a follow-up.
