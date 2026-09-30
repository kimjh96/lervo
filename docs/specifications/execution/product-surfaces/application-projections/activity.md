# `ProductActivityPageV1`

## Page contract

Required top-level fields:

- `schemaVersion: 1` and `kind: product_surface.activity`;
- exact source event-head hash and repository revision;
- bounded request cursor, returned cursor, nullable next cursor, and page limit;
- ordered activity items.

Each item requires a deterministic activity ID, observed time, actor coordinate, action class, bounded object coordinate, outcome, salience, privacy class, source coordinates, and projection status.

Action classes cover message, repository read, repository edit, command, verification, approval, handoff, delivery, failure, and lifecycle. New meanings require a new bounded class or schema version; free-form transport names are prohibited.

The projection excludes hidden reasoning, prompts, raw tool payloads, credentials, unrestricted paths, and private platform identifiers.

Invalid source evidence fails the page as `activity_evidence_invalid`; a stale cursor fails as `activity_cursor_stale`; an unsupported schema fails as `activity_schema_unsupported`. An empty valid page is distinct from unavailable evidence.

## Canonical projector

`@lervo/product-surface-projection` owns the host-neutral version-1 event-to-activity projector. Input is one bounded canonical event window containing exact event-head and repository hashes, request cursor, preceding event hash and sequence, at most `limit + 1` readable events, and a limit from 1 through 100.

The projector validates supported event schema versions, every event envelope, adjacent sequence and previous-hash continuity, recomputed event hashes, and final head equality when the window is complete.

Activity IDs and cursors derive deterministically from event hashes. A page with one look-ahead event returns the last rendered cursor as `nextCursor`. Replay after the verified head returns `empty` without inventing an event.

Classification uses only event type, envelope actor, time, and opaque coordinates. Payload fields never enter activity items. Provider usage and terminal observations are sensitive; hidden reasoning remains unobservable. Surfaces must resolve display text through a separately authorized source query.

## Installed query

Product-host protocol v8 exposes the projector through `lervo application activity [--cursor <cursor>] [--limit <1..100>] [--root <path>] --json`.

The command opens project storage read-only, verifies the complete event chain, fixes an event head, captures the repository revision, locates an opaque cursor in bounded-memory pages, and supplies only the requested `limit + 1` window to the projector.

An empty repository has no canonical event-head coordinate, so the command fails instead of fabricating an empty page. Concurrent events after the fixed head are excluded from the response and become visible on a later query.
