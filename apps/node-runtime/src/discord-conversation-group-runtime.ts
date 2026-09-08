import type { NodeDiscordConversationRuntime } from "./discord-conversation-runtime.js";

function closeEveryRuntime(
  runtimes: NodeDiscordConversationRuntime[],
  operation: (runtime: NodeDiscordConversationRuntime) => void,
): void {
  const errors: unknown[] = [];
  for (const runtime of runtimes) {
    try {
      operation(runtime);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors);
}

export function groupDiscordConversationRuntimes(
  runtimes: NodeDiscordConversationRuntime[],
): NodeDiscordConversationRuntime {
  if (runtimes.length === 0) throw new Error("A Discord runtime group cannot be empty.");
  return {
    failed: Promise.race(runtimes.map((runtime) => runtime.failed)),
    async observeRemoteAcknowledgement(input) {
      const results = await Promise.all(
        runtimes.map((runtime) => runtime.observeRemoteAcknowledgement(input)),
      );
      if (results.includes("ready")) return "ready";
      return results.includes("duplicate") ? "duplicate" : "ignored";
    },
    async runResultDeliveryCycle() {
      await Promise.all(runtimes.map((runtime) => runtime.runResultDeliveryCycle()));
    },
    stopIngress() {
      closeEveryRuntime(runtimes, (runtime) => runtime.stopIngress());
    },
    close() {
      closeEveryRuntime(runtimes, (runtime) => runtime.close());
    },
  };
}
