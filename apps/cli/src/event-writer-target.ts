import { coordinationEventSchemaVersion } from "@lervo/event-contract";

/**
 * The writer version repository upgrades converge on: the newest one a Lervo writer needs. Schema
 * 16 records a conversation's claims (`assignment.lease.widened`, `assignment.claim.refused`) and
 * an agent's `conversation_note` promotions; schema 15 records a room's mentions
 * (`room.participant.joined`, `room.mention.recorded`, `room.mention.delivered`,
 * `room.mention.failed`, `room.exchange.paused`) and the owner rules counted on
 * `terminal.context.prepared`. The earlier versions carry `terminal.context.base_delivered`, a
 * terminal hook's `delivery`, the turn ending of `terminal.turn.observed`, the hosted session
 * usage records, and the hosted session and plan ledger events (ADR-0650). A leaf module, so a
 * remedy can name it without loading the upgrade stages.
 */
export const TARGET_EVENT_SCHEMA_VERSION = coordinationEventSchemaVersion;
