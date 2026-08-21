import {
  validateManagedProviderRunEvidence,
  type ManagedProviderRunResult,
} from "@lervo/execution-contract";
import type { SharedContextPublication } from "@lervo/schemas";
import { collectRunEventsBounded, type EventStore } from "@lervo/storage-contract";

import { ManagedConversationResponseError } from "./types.js";

const maximumConversationManagedRunEvents = 2_000;

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
  let runEvents;
  try {
    runEvents = collectRunEventsBounded({
      events: input.events,
      runId: run.session.runId,
      maximumEvents: maximumConversationManagedRunEvents,
    });
  } catch (error) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "대화 응답 managed run event 범위를 확인하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
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
