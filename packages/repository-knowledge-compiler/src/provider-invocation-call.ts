import type { CreateProcessProviderOptions } from "./process-provider-contract.js";
import { runProcess, type ProcessResult } from "./process-host.js";
import { assertKnowledgeProviderAvailable } from "./provider-availability.js";
import { providerCliDispatchContext } from "./provider-dispatch-context.js";

/** Every model invocation crosses the same final identity and worker-observation boundary. */
export async function runNoCapabilityProcess(
  options: CreateProcessProviderOptions,
  request: Omit<Parameters<typeof runProcess>[0], "environment">,
): Promise<ProcessResult> {
  await options.beforeCall?.();
  const result = await runProcess({
    ...request,
    ...providerCliDispatchContext(options.environment),
  });
  if (result.status !== "spawn_failed") await options.onCall?.();
  assertKnowledgeProviderAvailable({ strategy: options.strategy, ...result });
  return result;
}
