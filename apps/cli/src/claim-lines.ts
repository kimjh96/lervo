// The room lines a conversation's claims add (Lervo ADE coordination, "What the owner sees").
import type { HostedDecodedEvent } from "@lervo/adapter-contract";

import { ClaimLog } from "./claim-log.js";

/** The most unresolved paths a turn's end names one by one; a last line counts the rest. */
const UNRESOLVED_LINES = 3;

/** Names an agent of the session's conversation, or null when its room does not know it. */
export type AgentNames = (agentId: string) => string | null;

/**
 * Adds the claim log's lines to a session's decoded events: after a tool call Lervo stopped, who
 * holds its path, or the held path when it differs from the requested one (`claim_conflict`); once
 * in a turn whose writes went ahead undecided, that the turn's end claims them (`claim_deferred`);
 * and at the turn's end, the paths its reconciliation left unresolved and who holds each
 * (`claim_unresolved`, then `claim_unresolved_more` for the rest). It reads the log only for a
 * tool call or a finished turn, and only once the log exists.
 */
export class ClaimLines {
  private log: ClaimLog | null = null;
  /** When each session's current turn began, as far as these lines are concerned. */
  private readonly turnSince = new Map<string, string>();

  constructor(
    private readonly openLog: () => ClaimLog | null = () => ClaimLog.openExisting(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  annotate(
    sessionId: string,
    agentId: string | null,
    events: readonly HostedDecodedEvent[],
    names: AgentNames,
  ): HostedDecodedEvent[] {
    if (!this.turnSince.has(sessionId)) this.turnSince.set(sessionId, this.now().toISOString());
    const lines: HostedDecodedEvent[] = [];
    for (const event of events) {
      if (event.kind === "status" && event.event === "turn_finished") {
        lines.push(...this.deferred(sessionId), ...this.unresolved(sessionId, names));
        this.turnSince.set(sessionId, this.now().toISOString());
      }
      lines.push(event);
      // A refused call usually ends failed, but its entry decides, whatever the provider reports.
      if (
        event.kind === "item" &&
        event.content.kind === "tool_activity" &&
        event.content.toolUseId !== undefined
      )
        lines.push(...this.stopped(sessionId, agentId, event.content.toolUseId, names));
    }
    return lines;
  }

  /** Forgets a session whose decoder closed. */
  forget(sessionId: string): void {
    this.turnSince.delete(sessionId);
  }

  private stopped(
    sessionId: string,
    agentId: string | null,
    toolUseId: string,
    names: AgentNames,
  ): HostedDecodedEvent[] {
    const entry = this.read((log) => log.ofToolUse(sessionId, toolUseId));
    if (entry === null || entry === undefined || entry.state !== "refused") return [];
    const holder = entry.holder;
    return [
      this.line("claim_conflict", {
        agent: (agentId === null ? null : names(agentId)) ?? "",
        path: entry.heldPaths?.[0] ?? entry.paths[0] ?? "",
        code: entry.code,
        holder: holder === null ? "" : (names(holder.agentId) ?? holder.agentId),
        workspace: holder?.workspaceId ?? "",
      }),
    ];
  }

  private deferred(sessionId: string): HostedDecodedEvent[] {
    const since = this.turnSince.get(sessionId) ?? this.now().toISOString();
    const first = this.read((log) => log.deferredSince(sessionId, since))?.[0];
    return first === undefined ? [] : [this.line("claim_deferred", { code: first.code })];
  }

  private unresolved(sessionId: string, names: AgentNames): HostedDecodedEvent[] {
    const since = this.turnSince.get(sessionId) ?? this.now().toISOString();
    const entries = this.read((log) => log.unresolvedSince(sessionId, since)) ?? [];
    const paths = entries.flatMap((entry) => entry.paths.map((path) => ({ path, entry })));
    const lines = paths.slice(0, UNRESOLVED_LINES).map(({ path, entry }) =>
      this.line("claim_unresolved", {
        path,
        code: entry.code,
        holder: entry.holder === null ? "" : (names(entry.holder.agentId) ?? entry.holder.agentId),
        workspace: entry.holder?.workspaceId ?? "",
      }),
    );
    if (paths.length > UNRESOLVED_LINES)
      lines.push(
        this.line("claim_unresolved_more", { count: String(paths.length - UNRESOLVED_LINES) }),
      );
    return lines;
  }

  /** Reads the log; a log that cannot be read adds no line, as a missing entry does. */
  private read<T>(query: (log: ClaimLog) => T): T | undefined {
    try {
      this.log ??= this.openLog();
      return this.log === null ? undefined : query(this.log);
    } catch {
      return undefined;
    }
  }

  private line(code: string, parameters: Record<string, string>): HostedDecodedEvent {
    return {
      kind: "item",
      content: { kind: "lervo_notice", code, parameters },
      createdAtMs: this.now().getTime(),
    };
  }
}
