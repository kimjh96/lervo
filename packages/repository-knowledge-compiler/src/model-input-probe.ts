import type { NoCapabilityJsonInvocationStrategy } from "@lervo/adapter-contract";

import { knowledgeInvocationFailure } from "./invocation-failure.js";
import { runProcess } from "./process-host.js";

/** Proves, without a model call, that the provider's model input carries no tool definition. */
export async function assertProviderModelInputHasNoTools(input: {
  strategy: NoCapabilityJsonInvocationStrategy;
  executable: string;
  environment?: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
}): Promise<void> {
  const admission = input.strategy.admission;
  if (admission.kind !== "model_input") return;
  try {
    await admission.assertNoModelTools(
      (request) =>
        runProcess({
          executable: input.executable,
          ...(input.environment === undefined ? {} : { environment: input.environment }),
          cwd: input.cwd,
          ...request,
        }),
      input.timeoutMs,
    );
  } catch (error) {
    throw knowledgeInvocationFailure(error);
  }
}
