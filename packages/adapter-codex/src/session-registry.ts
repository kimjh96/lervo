import type { AdapterSession } from "@roven/schemas";

import { assertAdapterMessage, clone, sameSession } from "./adapter-validation.js";
import {
  CodexAdapterError,
  type CodexAppServerClient,
  type CodexSessionState,
} from "./types.js";

export class CodexSessionRegistry {
  private readonly sessions = new Map<string, CodexSessionState>();

  has(providerSessionId: string): boolean {
    return this.sessions.has(providerSessionId);
  }

  add(session: AdapterSession, client: CodexAppServerClient): void {
    if (this.has(session.providerSessionId)) {
      throw new CodexAdapterError("provider_protocol_failed", "Codex thread ID가 중복되었습니다.");
    }
    this.sessions.set(session.providerSessionId, {
      session: clone(session),
      client,
      injectedTargetTurnIds: new Set(),
      startedTargetTurnIds: new Set(),
      turnResults: new Map(),
      eventStreamClaimed: false,
    });
  }

  get(session: AdapterSession): CodexSessionState {
    assertAdapterMessage(session, "Codex session");
    const state = this.sessions.get(session.providerSessionId);
    if (state === undefined) {
      throw new CodexAdapterError("session_not_found", "관리 중인 Codex session을 찾지 못했습니다.");
    }
    if (!sameSession(state.session, session)) {
      throw new CodexAdapterError("session_mismatch", "Codex session 좌표가 시작 시점과 다릅니다.");
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
