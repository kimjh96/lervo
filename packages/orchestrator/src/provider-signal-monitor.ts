import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { AdapterNormalizedEvent, AdapterSession } from "@lervo/schemas";

import { ManagedProviderRunError } from "./provider-run-types.js";

export interface ProviderSignalMonitor {
  terminal: Promise<AdapterNormalizedEvent>;
  abort(): void;
  done: Promise<void>;
  throwIfFailed(): void;
}

function isTerminal(event: AdapterNormalizedEvent): boolean {
  return event.type === "provider.turn.completed" || event.type === "provider.turn.failed";
}

export function startProviderSignalMonitor(input: {
  adapter: ProviderAdapter;
  session: AdapterSession;
  onEvent: (event: AdapterNormalizedEvent) => void;
}): ProviderSignalMonitor {
  const controller = new AbortController();
  let resolveTerminal!: (event: AdapterNormalizedEvent) => void;
  let rejectTerminal!: (error: Error) => void;
  let settled = false;
  let failure: Error | undefined;
  const terminal = new Promise<AdapterNormalizedEvent>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  void terminal.catch(() => undefined);

  const done = (async () => {
    try {
      for await (const event of input.adapter.events(input.session, controller.signal)) {
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
