import type { SupervisionRequestRefusalCode } from "./supervision-request-refusal.js";

/** What the shared intake writer observed for one Discord goal event; the status edit repeats only this. */
export type DiscordGoalIntakeOutcome =
  | { status: "bound" }
  | { status: "duplicate" }
  | { status: "refused"; code: SupervisionRequestRefusalCode }
  | { status: "uncertain" };

const MAXIMUM_RETAINED_OUTCOMES = 256;

/** In-memory, bounded, single-process hand-off from the work responder to the command acknowledger. */
export class DiscordGoalIntakeOutcomes {
  private readonly outcomes = new Map<string, DiscordGoalIntakeOutcome>();

  record(eventId: string, outcome: DiscordGoalIntakeOutcome): void {
    this.outcomes.delete(eventId);
    if (this.outcomes.size >= MAXIMUM_RETAINED_OUTCOMES)
      this.outcomes.delete(this.outcomes.keys().next().value!);
    this.outcomes.set(eventId, structuredClone(outcome));
  }

  /** Removes and returns the recorded outcome; a missing record means the intake was never observed. */
  take(eventId: string): DiscordGoalIntakeOutcome | null {
    const outcome = this.outcomes.get(eventId) ?? null;
    this.outcomes.delete(eventId);
    return outcome;
  }
}

const REFUSAL_MESSAGES: Partial<Record<SupervisionRequestRefusalCode, string>> = {
  origin_conflict:
    "현재 목표에는 이미 다른 요청이 연결되어 있어 이 요청을 연결하지 않았습니다. 새 요청은 별도 목표로 접수해야 합니다.",
  workstream_inactive: "연결할 활성 목표가 없어 요청을 연결하지 않았습니다.",
  owner_busy:
    "담당자가 작업 중이어서 제한 시간 안에 요청을 연결하지 못했습니다. 요청은 기록되지 않았으니 잠시 후 다시 시도해 주세요.",
};

export const DISCORD_GOAL_INTAKE_UNCERTAIN_MESSAGE =
  "요청 처리 상태를 확인하지 못했습니다. 중복 실행을 피하려면 운영 담당자에게 알려 주세요.";

/** Fixed status text per observed outcome; a missing outcome is reported as uncertain, never as success. */
export function discordGoalIntakeStatusMessage(outcome: DiscordGoalIntakeOutcome | null): string {
  switch (outcome?.status) {
    case "bound":
      return "현재 진행 중인 목표에 요청을 연결했습니다. 검증과 완료 결과는 이 대화의 답글로 안내합니다.";
    case "duplicate":
      return "동일한 요청은 이미 현재 목표에 연결되어 있습니다. 검증과 완료 결과는 이 대화의 답글로 안내합니다.";
    case "refused":
      return (
        REFUSAL_MESSAGES[outcome.code] ??
        `요청을 현재 목표에 연결하지 않았습니다. 사유 코드는 ${outcome.code}입니다.`
      );
    default:
      return DISCORD_GOAL_INTAKE_UNCERTAIN_MESSAGE;
  }
}
