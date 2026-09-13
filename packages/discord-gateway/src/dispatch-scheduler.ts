import type { DiscordGatewayDriverOptions } from "./types.js";

/** Keeps message order while giving interaction callbacks a bounded independent lane. */
export class DiscordGatewayDispatchScheduler {
  private messageChain = Promise.resolve();
  private activeInteractions = 0;

  constructor(
    private readonly dispatch: DiscordGatewayDriverOptions["onDispatch"],
    private readonly report: (message: string, error?: unknown) => void,
  ) {}

  schedule(
    eventName: string,
    input: Parameters<DiscordGatewayDriverOptions["onDispatch"]>[0],
  ): void {
    if (eventName === "INTERACTION_CREATE") {
      if (this.activeInteractions >= 64) {
        this.report("Too many concurrent Discord interactions.");
        return;
      }
      this.activeInteractions += 1;
      void Promise.resolve()
        .then(() => this.dispatch(input))
        .catch((error: unknown) => this.report("Authenticated Discord interaction failed.", error))
        .finally(() => {
          this.activeInteractions -= 1;
        });
      return;
    }
    this.messageChain = this.messageChain
      .then(() => this.dispatch(input))
      .catch((error: unknown) =>
        this.report("Authenticated Discord dispatch handling failed.", error),
      );
  }
}
