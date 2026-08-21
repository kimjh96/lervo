import {
  assertConversationDeliberationSummary,
  conversationDeliberationPatterns,
} from "./deliberation-job.js";
import type { ConversationDeliberationSummary } from "./types.js";
import { ConversationControlError } from "./types.js";

export interface ConversationDeliberationLeasedJob {
  deliberationId: string;
}

export interface ConversationDeliberationLeaseStore<
  TJob extends ConversationDeliberationLeasedJob,
  TFailureCode extends string,
> {
  claim(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<{ leaseId: string; job: TJob } | null>;
  renew(input: {
    deliberationId: string;
    leaseId: string;
    renewedAt: string;
    leaseDurationMs: number;
  }): Promise<void>;
  settle(input: {
    deliberationId: string;
    leaseId: string;
    settledAt: string;
    summary: ConversationDeliberationSummary;
  }): Promise<void>;
  markUncertain(input: {
    deliberationId: string;
    leaseId: string;
    failedAt: string;
    failureCode: TFailureCode;
  }): Promise<void>;
}

export type ConversationDeliberationLeaseCycleResult<TFailureCode extends string> =
  | { status: "idle" }
  | {
      status: "settled";
      deliberationId: string;
      summary: ConversationDeliberationSummary;
    }
  | {
      status: "uncertain";
      deliberationId: string;
      failureCode: TFailureCode;
    };

export async function runConversationDeliberationLeaseCycle<
  TJob extends ConversationDeliberationLeasedJob,
  TFailureCode extends string,
>(options: {
  store: ConversationDeliberationLeaseStore<TJob, TFailureCode>;
  execute(job: Readonly<TJob>): Promise<ConversationDeliberationSummary>;
  executionFailureCode: TFailureCode;
  workerId: string;
  now?: () => Date;
  leaseDurationMs?: number;
}): Promise<ConversationDeliberationLeaseCycleResult<TFailureCode>> {
  const leaseDurationMs = options.leaseDurationMs ?? 5 * 60_000;
  if (
    !conversationDeliberationPatterns.workerId.test(options.workerId) ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 10_000 || leaseDurationMs > 60 * 60_000
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "숙의 worker 설정이 유효하지 않습니다.",
    );
  }
  const now = options.now ?? (() => new Date());
  const lease = await options.store.claim({
    workerId: options.workerId,
    claimedAt: now().toISOString(),
    leaseDurationMs,
  });
  if (lease === null) return { status: "idle" };

  let renewal = Promise.resolve();
  let renewalFailed = false;
  const heartbeat = setInterval(() => {
    renewal = renewal.then(async () => {
      if (renewalFailed) return;
      await options.store.renew({
        deliberationId: lease.job.deliberationId,
        leaseId: lease.leaseId,
        renewedAt: now().toISOString(),
        leaseDurationMs,
      });
    }).catch(() => {
      renewalFailed = true;
    });
  }, Math.max(1_000, Math.floor(leaseDurationMs / 3)));
  heartbeat.unref();

  try {
    const summary = await options.execute(structuredClone(lease.job));
    clearInterval(heartbeat);
    await renewal;
    if (renewalFailed) {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "숙의 worker lease를 갱신하지 못했습니다.",
      );
    }
    assertConversationDeliberationSummary(summary, lease.job.deliberationId);
    if (summary.status === "running" || summary.status === "unknown" ||
      summary.status === "interrupted") {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "숙의 worker 실행 결과가 종료 상태가 아닙니다.",
      );
    }
    await options.store.settle({
      deliberationId: lease.job.deliberationId,
      leaseId: lease.leaseId,
      settledAt: now().toISOString(),
      summary,
    });
    return {
      status: "settled",
      deliberationId: lease.job.deliberationId,
      summary: structuredClone(summary),
    };
  } catch {
    clearInterval(heartbeat);
    await renewal;
    await options.store.markUncertain({
      deliberationId: lease.job.deliberationId,
      leaseId: lease.leaseId,
      failedAt: now().toISOString(),
      failureCode: options.executionFailureCode,
    });
    return {
      status: "uncertain",
      deliberationId: lease.job.deliberationId,
      failureCode: options.executionFailureCode,
    };
  }
}
