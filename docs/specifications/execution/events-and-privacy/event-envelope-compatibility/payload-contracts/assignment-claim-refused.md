# `assignment.claim.refused`

In Lervo ADE coordination, a conversation's agent claims each path before it writes. Schema 16 adds this event, which records a claim Lervo refused and the write it stopped. Schemas 1 through 15 reject the type. The event proves that Lervo refused the claim, not that the provider honored the refusal.

The coordination specification is `docs/specifications/execution/product-surfaces/ade-coordination.md` ("Event schema 16" and its codes table), proposed on the `ade-coordination-spec` branch at revision 719a7e2c1.

## Fields

All ten fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `assignmentId`: the claiming conversation's assignment, `asn_` and 24 hex digits.
- `agentId`: the claiming agent, `agt_` and 24 hex digits.
- `leaseGeneration`: the claiming lease's generation, an integer of at least 1.
- `code`: why the claim was refused, one of:
  - `path_leased`: another assignment's live write lease overlaps the path.
  - `path_changed_unsealed`: another conversation's worktree changed the path and has not sealed it.
  - `path_awaiting_integration`: another conversation's sealed change touched the path and has not integrated.
  - `outside_responsibility`: the path is outside the lead's responsibility paths.
  - `path_outside_workspace`: the path is inside another checkout of the repository.
  - `lease_path_limit`: the lease holds 10,000 entries and cannot coalesce without overlapping another holder.
- `holderAgentId`: the agent that holds the path, `agt_` and 24 hex digits, or null where no holder applies.
- `holderAssignmentId`: the holder's assignment, `asn_` and 24 hex digits, or null.
- `holderWorkspaceId`: the holder's conversation, `wsp_` and 24 hex digits, or null.
- `pathDigest`: `hmac-sha256:` and 64 hex digits, the HMAC-SHA-256 of `lervo.claim.path.v1` and the path, joined by NUL, under the repository instance's local secret. A replicated event names no guessable path, and the prefix keeps it apart from the unkeyed `sha256:` digests.
- `detection`: how the claim was found: `tool` for a file tool's input, `shell` for a command's targets, or `reconcile` for a path the turn's end found changed.
- `occurredAt`: when the claim was refused.

## Envelope

The coordination stage records the event in the repository's store, as the workforce records `assignment.claimed`. The envelope has `schemaVersion: 16`. Lervo records at most one event per session, holder, and path digest in a turn.

It carries no path, tool input, command text, file content, conversation title, the refusal's message, provider session ID, or tool use ID. Readers ship first: no release records the event yet, and the writer target stays below 16.

## Failure meaning

- The writer records the event only at schema 16 or later. Below 16, the coordination stage does not run, and conversations write without claims.
- Each event is final for its refusal. A later claim of the same path is a new event.
- A `code` outside the six above is refused rather than kept as an open string, so a new code needs a new reader first. Codes that stop no write, such as `claim_deferred` or the seal codes, never appear here.
- A `detection` outside the three above is refused for the same reason.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 16.
