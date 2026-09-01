import type {
  ExecutionStagesObservedEventPayload,
  RepositoryPerformanceProfile,
} from "@lervo/schemas";
import { executionStageIds } from "@lervo/schemas";

export type ExecutionStageId = (typeof executionStageIds)[number];
export type ExecutionStageOutcome =
  ExecutionStagesObservedEventPayload["stages"][number]["outcome"];
export type ExecutionColdState = ExecutionStagesObservedEventPayload["stages"][number]["coldState"];

export type MonotonicClock = () => bigint;

export interface ExecutionStageToken {
  readonly tokenId: number;
  readonly stageId: ExecutionStageId;
}

export class ExecutionStageTimingError extends Error {
  constructor(
    readonly code:
      | "clock_invalid"
      | "clock_regressed"
      | "stage_duplicate_active"
      | "stage_parent_conflict"
      | "stage_token_invalid"
      | "stage_tree_invalid",
    message: string,
  ) {
    super(message);
    this.name = "ExecutionStageTimingError";
  }
}

interface ActiveStage {
  tokenId: number;
  stageId: ExecutionStageId;
  parentStageId: ExecutionStageId | null;
  startedNanoseconds: bigint;
}

type StageObservation = ExecutionStagesObservedEventPayload["stages"][number];

const outcomeSeverity: Record<ExecutionStageOutcome, number> = {
  completed: 0,
  abstained: 1,
  cancelled: 2,
  timeout: 3,
  failed: 4,
};

function durationMilliseconds(start: bigint, end: bigint): number {
  const nanoseconds = end - start;
  return Number(nanoseconds / 1_000n) / 1_000;
}

export class ExecutionStageRecorder {
  private readonly active = new Map<number, ActiveStage>();
  private readonly activeStageIds = new Set<ExecutionStageId>();
  private readonly observations = new Map<ExecutionStageId, StageObservation>();
  private lastClockValue: bigint | null = null;
  private nextTokenId = 1;

  constructor(
    private readonly options: {
      clock: MonotonicClock;
      coldState: ExecutionColdState;
      budgets?: Partial<Record<ExecutionStageId, number>>;
    },
  ) {}

  begin(stageId: ExecutionStageId, parentStageId: ExecutionStageId | null): ExecutionStageToken {
    if (this.activeStageIds.has(stageId)) {
      throw new ExecutionStageTimingError(
        "stage_duplicate_active",
        `Execution stage ${stageId} is already active.`,
      );
    }
    const tokenId = this.nextTokenId++;
    this.active.set(tokenId, {
      tokenId,
      stageId,
      parentStageId,
      startedNanoseconds: this.readClock(),
    });
    this.activeStageIds.add(stageId);
    return { tokenId, stageId };
  }

  finish(token: ExecutionStageToken, outcome: ExecutionStageOutcome): void {
    const active = this.active.get(token.tokenId);
    if (active === undefined || active.stageId !== token.stageId) {
      throw new ExecutionStageTimingError(
        "stage_token_invalid",
        "The execution stage token is absent or does not match its stage.",
      );
    }
    const durationMs = durationMilliseconds(active.startedNanoseconds, this.readClock());
    this.active.delete(active.tokenId);
    this.activeStageIds.delete(active.stageId);
    const previous = this.observations.get(active.stageId);
    if (previous !== undefined && previous.parentStageId !== active.parentStageId) {
      throw new ExecutionStageTimingError(
        "stage_parent_conflict",
        `Execution stage ${active.stageId} changed parent.`,
      );
    }
    this.observations.set(active.stageId, {
      stageId: active.stageId,
      parentStageId: active.parentStageId,
      durationMs: (previous?.durationMs ?? 0) + durationMs,
      budgetMs: this.options.budgets?.[active.stageId] ?? null,
      outcome:
        previous === undefined || outcomeSeverity[outcome] > outcomeSeverity[previous.outcome]
          ? outcome
          : previous.outcome,
      coldState: this.options.coldState,
    });
  }

  async measure<T>(
    stageId: ExecutionStageId,
    parentStageId: ExecutionStageId | null,
    operation: () => Promise<T>,
  ): Promise<T> {
    const token = this.begin(stageId, parentStageId);
    try {
      const result = await operation();
      this.finish(token, "completed");
      return result;
    } catch (error) {
      this.finish(token, "failed");
      throw error;
    }
  }

  measureSync<T>(
    stageId: ExecutionStageId,
    parentStageId: ExecutionStageId | null,
    operation: () => T,
  ): T {
    const token = this.begin(stageId, parentStageId);
    try {
      const result = operation();
      this.finish(token, "completed");
      return result;
    } catch (error) {
      this.finish(token, "failed");
      throw error;
    }
  }

  snapshot(): StageObservation[] {
    if (this.active.size > 0) {
      throw new ExecutionStageTimingError(
        "stage_tree_invalid",
        "Execution stage observations cannot be finalized with active stages.",
      );
    }
    const observations = [...this.observations.values()];
    assertExecutionStageSet(observations);
    return observations.map((item) => structuredClone(item));
  }

  private readClock(): bigint {
    let value: bigint;
    try {
      value = this.options.clock();
    } catch {
      throw new ExecutionStageTimingError("clock_invalid", "The monotonic clock failed.");
    }
    if (typeof value !== "bigint" || value < 0n) {
      throw new ExecutionStageTimingError(
        "clock_invalid",
        "The monotonic clock returned an invalid value.",
      );
    }
    if (this.lastClockValue !== null && value < this.lastClockValue) {
      throw new ExecutionStageTimingError("clock_regressed", "The monotonic clock regressed.");
    }
    this.lastClockValue = value;
    return value;
  }
}

export function assertExecutionStageSet(observations: readonly StageObservation[]): void {
  const ids = new Set(observations.map((item) => item.stageId));
  if (
    observations.length === 0 ||
    ids.size !== observations.length ||
    observations.some(
      (item) =>
        item.parentStageId === item.stageId ||
        (item.parentStageId !== null && !ids.has(item.parentStageId)),
    )
  ) {
    throw new ExecutionStageTimingError(
      "stage_tree_invalid",
      "Execution stage observations contain an absent or self parent.",
    );
  }
}

export interface ExecutionPerformanceProfileDeclaration {
  repositoryProfile: RepositoryPerformanceProfile;
  coldState: ExecutionColdState;
  concurrency: number;
}
