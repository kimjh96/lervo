import type { AdapterSession } from "@lervo/schemas";

import { assertAdapterMessage, clone, sameSession } from "./adapter-validation.js";
import { ClaudeAdapterError, type ClaudeAgentClient, type ClaudeSessionState } from "./types.js";

export class ClaudeSessionRegistry {
  private readonly sessions = new Map<string, ClaudeSessionState>();

  has(providerSessionId: string): boolean {
    return this.sessions.has(providerSessionId);
  }

  add(
    session: AdapterSession,
    client: ClaudeAgentClient,
    capabilityActivations: ClaudeSessionState["capabilityActivations"],
  ): void {
    if (this.sessions.has(session.providerSessionId)) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "The Claude session ID is duplicated.",
      );
    }
    this.sessions.set(session.providerSessionId, {
      session: clone(session),
      client,
      injectedTargetTurnIds: new Set(),
      startedTargetTurnIds: new Set(),
      turnResults: new Map(),
      eventStreamClaimed: false,
      capabilityActivations: structuredClone(capabilityActivations),
      activationConfirmed: false,
    });
  }

  get(session: AdapterSession): ClaudeSessionState {
    assertAdapterMessage(session, "Claude session");
    const state = this.sessions.get(session.providerSessionId);
    if (state === undefined) {
      throw new ClaudeAdapterError(
        "session_not_found",
        "The managed Claude session was not found.",
      );
    }
    if (!sameSession(state.session, session)) {
      throw new ClaudeAdapterError(
        "session_mismatch",
        "The Claude session coordinates differ from their initial values.",
      );
    }
    return state;
  }

  release(session: AdapterSession): void {
    const state = this.get(session);
    state.injectedTargetTurnIds.clear();
    state.startedTargetTurnIds.clear();
    state.turnResults.clear();
    state.managedWrites?.clear();
    delete state.managedWrites;
    delete state.activeTurn;
    delete state.activeProviderTurnId;
    this.sessions.delete(session.providerSessionId);
  }
}
