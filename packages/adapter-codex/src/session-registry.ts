import type { AdapterSession } from "@lervo/schemas";

import { assertAdapterMessage, clone, sameSession } from "./adapter-validation.js";
import { CodexAdapterError, type CodexAppServerClient, type CodexSessionState } from "./types.js";

export class CodexSessionRegistry {
  private readonly sessions = new Map<string, CodexSessionState>();

  has(providerSessionId: string): boolean {
    return this.sessions.has(providerSessionId);
  }

  add(
    session: AdapterSession,
    client: CodexAppServerClient,
    capabilityActivations: CodexSessionState["capabilityActivations"],
    requestedModel: string | null,
    sessionObservedModel: string | null,
  ): void {
    if (this.has(session.providerSessionId)) {
      throw new CodexAdapterError("provider_protocol_failed", "The Codex thread ID is duplicated.");
    }
    this.sessions.set(session.providerSessionId, {
      session: clone(session),
      client,
      injectedTargetTurnIds: new Set(),
      startedTargetTurnIds: new Set(),
      turnResults: new Map(),
      requestedModel,
      sessionObservedModel,
      eventStreamClaimed: false,
      capabilityActivations: structuredClone(capabilityActivations),
      activationConfirmed: false,
    });
  }

  get(session: AdapterSession): CodexSessionState {
    assertAdapterMessage(session, "Codex session");
    const state = this.sessions.get(session.providerSessionId);
    if (state === undefined) {
      throw new CodexAdapterError("session_not_found", "The managed Codex session was not found.");
    }
    if (!sameSession(state.session, session)) {
      throw new CodexAdapterError(
        "session_mismatch",
        "The Codex session coordinates differ from their initial values.",
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
