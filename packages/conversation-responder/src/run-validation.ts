import {
  validateManagedProviderRunEvidence,
  type ManagedProviderRunResult,
} from "@lervo/orchestrator";
import type { EventEnvelope, SharedContextPublication } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

import { ManagedConversationResponseError } from "./types.js";

function eventsForRun(store: EventStore, runId: string): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const page = store.list({ runId, afterSeq, limit: 1_000 });
    events.push(...page);
    if (page.length < 1_000) return events;
    afterSeq = page.at(-1)!.seq;
  }
}

export function validateConversationManagedRun(input: {
  run: ManagedProviderRunResult;
  events: EventStore;
  requestDigest: string;
  roleId: string;
  targetTurnId: string;
  publications: readonly SharedContextPublication[];
}): void {
  const { run } = input;
  if (
    run.session.executionMode !== "read_only" ||
    run.managedChanges.length !== 0 ||
    run.beforeRevision !== run.afterRevision ||
    run.session.roleId !== input.roleId ||
    run.turn.targetTurnId !== input.targetTurnId
  ) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "대화 응답 managed run이 읽기 전용 역할과 결과 좌표를 지키지 않았습니다.",
    );
  }
  const runEvents = eventsForRun(input.events, run.session.runId);
  const requested = runEvents.filter((event) => event.type === "run.requested");
  if (
    requested.length !== 1 ||
    requested[0]!.payload.requestDigest !== input.requestDigest ||
    requested[0]!.payload.role !== input.roleId
  ) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "대화 원문 hash와 managed run 요청 원본이 서로 연결되지 않았습니다.",
    );
  }
  try {
    validateManagedProviderRunEvidence({
      run,
      events: runEvents,
      sharedContextPublications: input.publications,
    });
  } catch (error) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "대화 응답에 필요한 E2/E3 공통 맥락 증거를 확인하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
