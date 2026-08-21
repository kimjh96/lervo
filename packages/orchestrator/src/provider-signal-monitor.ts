import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { AdapterNormalizedEvent, AdapterSession } from "@lervo/schemas";

import { ManagedProviderRunError } from "./provider-run-types.js";

export interface ProviderSignalMonitor {
  terminal: Promise<AdapterNormalizedEvent>;
  abort(): void;
  done: Promise<void>;
  throwIfFailed(): void;
}

export const defaultMaximumProviderSignals = 500;
export const absoluteMaximumProviderSignals = 10_000;

export function resolveMaximumProviderSignals(value: number | undefined): number {
  const resolved = value ?? defaultMaximumProviderSignals;
  if (
    !Number.isSafeInteger(resolved) || resolved < 1 ||
    resolved > absoluteMaximumProviderSignals
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      `maximumProviderSignals는 1 이상 ${absoluteMaximumProviderSignals} 이하여야 합니다.`,
    );
  }
  return resolved;
}

function isTerminal(event: AdapterNormalizedEvent): boolean {
  return event.type === "provider.turn.completed" || event.type === "provider.turn.failed";
}

export function startProviderSignalMonitor(input: {
  adapter: ProviderAdapter;
  session: AdapterSession;
  onEvent: (event: AdapterNormalizedEvent) => void;
  maximumEvents?: number;
}): ProviderSignalMonitor {
  const maximumEvents = resolveMaximumProviderSignals(input.maximumEvents);
  const controller = new AbortController();
  let resolveTerminal!: (event: AdapterNormalizedEvent) => void;
  let rejectTerminal!: (error: Error) => void;
  let settled = false;
  let failure: Error | undefined;
  let observedEvents = 0;
  const terminal = new Promise<AdapterNormalizedEvent>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  void terminal.catch(() => undefined);

  const done = (async () => {
    try {
      for await (const event of input.adapter.events(input.session, controller.signal)) {
        observedEvents += 1;
        if (observedEvents > maximumEvents) {
          throw new ManagedProviderRunError(
            "provider_stream_failed",
            `Provider signal이 허용된 ${maximumEvents}개를 넘었습니다.`,
          );
        }
        try {
          input.onEvent(event);
        } catch (error) {
          failure =
            error instanceof Error
              ? error
              : new ManagedProviderRunError(
                  "provider_stream_failed",
                  "Provider signal을 처리하지 못했습니다.",
                );
          throw failure;
        }
        if (!settled && isTerminal(event)) {
          settled = true;
          resolveTerminal(structuredClone(event));
        }
      }
      if (!controller.signal.aborted && !settled) {
        throw new ManagedProviderRunError(
          "provider_stream_failed",
          "Provider event stream이 turn 결과 전에 끝났습니다.",
        );
      }
    } catch (error) {
      if (controller.signal.aborted && failure === undefined) return;
      failure ??=
        error instanceof ManagedProviderRunError
          ? error
          : new ManagedProviderRunError(
              "provider_stream_failed",
              "Provider event stream을 읽지 못했습니다.",
              { cause: error },
            );
      if (!settled) {
        settled = true;
        rejectTerminal(failure);
      }
      controller.abort();
    }
  })();

  return {
    terminal,
    abort: () => controller.abort(),
    done,
    throwIfFailed: () => {
      if (failure !== undefined) throw failure;
    },
  };
}
