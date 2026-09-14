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

async function closeEveryRuntimeAsync(runtimes: NodeDiscordConversationRuntime[]): Promise<void> {
  const results = await Promise.allSettled(
    runtimes.map((runtime) => Promise.resolve().then(() => runtime.close())),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors);
}

export function groupDiscordConversationRuntimes(
  runtimes: NodeDiscordConversationRuntime[],
): NodeDiscordConversationRuntime {
  if (runtimes.length === 0) throw new Error("A Discord runtime group cannot be empty.");
  return {
    failed: Promise.race(runtimes.map((runtime) => runtime.failed)),
    resultAdapter(integrationId) {
      const adapters = runtimes.flatMap((runtime) => runtime.resultAdapter?.(integrationId) ?? []);
      if (adapters.length > 1)
        throw new Error("A result integration has conflicting runtime adapters.");
      return adapters[0] ?? null;
    },
    resultArtifacts(integrationId) {
      const stores = runtimes.flatMap((runtime) => runtime.resultArtifacts?.(integrationId) ?? []);
      if (stores.length > 1)
        throw new Error("A result integration has conflicting runtime artifact stores.");
      return stores[0] ?? null;
    },
    resultReplay(integrationId, outboundId) {
      const states = runtimes.flatMap(
        (runtime) => runtime.resultReplay?.(integrationId, outboundId) ?? [],
      );
      if (states.length > 1)
        throw new Error("A result integration has conflicting runtime replay states.");
      return states[0] ?? null;
    },
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
    async close() {
      await closeEveryRuntimeAsync(runtimes);
    },
  };
}
