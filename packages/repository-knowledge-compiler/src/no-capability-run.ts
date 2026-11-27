import { writeFile } from "node:fs/promises";

import type {
  NoCapabilityJsonInvocation,
  NoCapabilityJsonInvocationStrategy,
} from "@lervo/adapter-contract";

import { withKnowledgeInvocationFailures } from "./invocation-failure.js";
import type { NoCapabilityTelemetry, ProviderJsonUsage } from "./process-provider-contract.js";

/** Writes the files a run reads into its private directory; an existing file is never replaced. */
export async function writeInvocationFiles(invocation: NoCapabilityJsonInvocation): Promise<void> {
  for (const file of invocation.files)
    await writeFile(file.path, file.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

/**
 * The adapter proves the run used no tool, permission, or server capability, so every capability
 * counter of the observed response is zero.
 */
export function parseNoCapabilityRun<T extends { telemetry: NoCapabilityTelemetry }>(
  strategy: NoCapabilityJsonInvocationStrategy,
  stdout: string,
): { observed: T; usage: ProviderJsonUsage | null } {
  const { result, usage } = withKnowledgeInvocationFailures(() => strategy.parseRun(stdout));
  const observed = {
    ...result,
    telemetry: {
      filesystemReads: 0,
      filesystemWrites: 0,
      shellProcesses: 0,
      networkRequests: 0,
      externalActions: 0,
      toolCalls: 0,
      complete: true,
    },
  } as unknown as T;
  return { observed, usage };
}
