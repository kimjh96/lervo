import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { AdapterNormalizedEvent, AdapterSession } from "@lervo/schemas";

import { ManagedProviderRunError } from "./provider-run-types.js";

export interface ProviderSignalMonitor {
  waitForTerminal(): Promise<AdapterNormalizedEvent>;
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
      `maximumProviderSignals must be between 1 and ${absoluteMaximumProviderSignals}.`,
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
  const terminals: AdapterNormalizedEvent[] = [];
  const waiters: Array<{
    resolve: (event: AdapterNormalizedEvent) => void;
    reject: (error: Error) => void;
  }> = [];
  let terminalCount = 0;
  let ended = false;
  let failure: Error | undefined;
  let observedEvents = 0;

  function fail(error: Error): void {
    failure ??= error;
    for (const waiter of waiters.splice(0)) waiter.reject(failure);
  }

  const done = (async () => {
    try {
      for await (const event of input.adapter.events(input.session, controller.signal)) {
        observedEvents += 1;
        if (observedEvents > maximumEvents) {
          throw new ManagedProviderRunError(
            "provider_stream_failed",
            `Provider signals exceeded the allowed maximum of ${maximumEvents}.`,
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
                  "Could not process the provider signal.",
                );
          throw failure;
        }
        if (isTerminal(event)) {
          terminalCount += 1;
          const terminal = structuredClone(event);
          const waiter = waiters.shift();
          if (waiter === undefined) terminals.push(terminal);
          else waiter.resolve(terminal);
        }
      }
      ended = true;
      if (!controller.signal.aborted) {
        const error = new ManagedProviderRunError(
          "provider_stream_failed",
          terminalCount === 0
            ? "The provider event stream ended before the turn result."
            : "The provider event stream ended before the next turn result.",
        );
        if (terminalCount === 0 || waiters.length > 0) fail(error);
      }
    } catch (error) {
      if (controller.signal.aborted && failure === undefined) return;
      fail(
        error instanceof ManagedProviderRunError
          ? error
          : new ManagedProviderRunError(
              "provider_stream_failed",
              "Could not read the provider event stream.",
              { cause: error },
            ),
      );
      controller.abort();
    }
  })();

  return {
    waitForTerminal: () => {
      const terminal = terminals.shift();
      if (terminal !== undefined) return Promise.resolve(structuredClone(terminal));
      if (failure !== undefined) return Promise.reject(failure);
      if (ended) {
        return Promise.reject(new ManagedProviderRunError(
          "provider_stream_failed",
          "The provider event stream ended before the next turn result.",
        ));
      }
      return new Promise<AdapterNormalizedEvent>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    abort: () => controller.abort(),
    done,
    throwIfFailed: () => {
      if (failure !== undefined) throw failure;
    },
  };
}
