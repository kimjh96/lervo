import {
  ManagedProviderRunError,
  type ManagedProviderRunFailureCode,
} from "./provider-run-types.js";

export interface ManagedProviderRunDeadlines {
  snapshotMs: number;
  providerTurnMs: number;
  streamDrainMs: number;
  adapterStopMs: number;
}

export const defaultManagedProviderRunDeadlines: ManagedProviderRunDeadlines = {
  snapshotMs: 30_000,
  providerTurnMs: 10 * 60_000,
  streamDrainMs: 5_000,
  adapterStopMs: 10_000,
};

export function resolveManagedProviderRunDeadlines(
  overrides: Partial<ManagedProviderRunDeadlines> | undefined,
): ManagedProviderRunDeadlines {
  const resolved = { ...defaultManagedProviderRunDeadlines, ...overrides };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        `Managed run deadline ${name}이 1 이상의 안전한 정수가 아닙니다.`,
      );
    }
  }
  return resolved;
}

export async function withinDeadline<T>(input: {
  operation: () => Promise<T>;
  timeoutMs: number;
  failureCode: ManagedProviderRunFailureCode;
  label: string;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = input.operation();
  void operation.catch(() => undefined);
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ManagedProviderRunError(
                input.failureCode,
                `${input.label} 제한 시간 ${input.timeoutMs}ms를 초과했습니다.`,
              ),
            ),
          input.timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
