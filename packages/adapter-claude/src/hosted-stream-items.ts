// The conversation items Claude Code's stream and transcript share: relayed peer messages and
// compaction notices.
import type { HostedDecodedContent } from "@lervo/adapter-contract";

type Line = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Where Claude Code appends a notice of its own to a relayed message's body. */
const RELAY_NOTICE = "\n\n<artifact-content-authored-by-others/>";

/**
 * A message another session sent, from a user line's `origin`: Claude Code marks one with `kind:
 * "peer"`, the sender's session name, and the message's body.
 */
export function peerMessage(origin: Line | undefined): HostedDecodedContent | undefined {
  if (origin?.kind !== "peer") return undefined;
  const body = text(origin.body);
  if (body === undefined) return undefined;
  const cut = body.indexOf(RELAY_NOTICE);
  const from = text(origin.name)?.trim();
  return {
    kind: "peer_message",
    from: (from === undefined || from.length === 0 ? "another session" : from).slice(0, 128),
    text: (cut === -1 ? body : body.slice(0, cut)).trim(),
  };
}

/** The notice for a compaction: `manual` when the person ran /compact, otherwise `auto`. */
export function compacted(trigger: unknown): HostedDecodedContent {
  return {
    kind: "lervo_notice",
    code: "context_compacted",
    parameters: { trigger: trigger === "manual" ? "manual" : "auto" },
  };
}
