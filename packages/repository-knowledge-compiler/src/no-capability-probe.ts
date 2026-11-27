import {
  NO_CAPABILITY_PROBE_TOOL_NAMES,
  type NoCapabilityJsonInvocationStrategy,
} from "@lervo/adapter-contract";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { withKnowledgeInvocationFailures } from "./invocation-failure.js";
import { assertProviderModelInputHasNoTools } from "./model-input-probe.js";
import {
  assertKnowledgeProviderAvailable,
  KnowledgeProviderAvailabilityError,
} from "./provider-availability.js";
import { providerCliDispatchContext } from "./provider-dispatch-context.js";
import type { ProviderJsonUsage } from "./process-provider-contract.js";
import { runProcess } from "./process-host.js";

export type ProviderCliProbeResult =
  | { admitted: true; probeResultHash: string }
  | {
      admitted: false;
      reason: "capabilities_exposed" | "probe_failed" | "probe_timed_out" | "identity_changed";
      exposedTools: string[];
    };

/** The existing run boundary also owns admission. No provider output leaves this adapter. */
export async function probeProviderCli(input: {
  strategy: NoCapabilityJsonInvocationStrategy;
  executable: string;
  environment?: NodeJS.ProcessEnv;
  observeUsage?: (usage: ProviderJsonUsage | null) => Promise<void>;
}): Promise<ProviderCliProbeResult> {
  const { cwd, environment } = providerCliDispatchContext(input.environment);
  const admission = input.strategy.admission;
  try {
    if (admission.kind === "model_input") {
      await assertProviderModelInputHasNoTools({
        strategy: input.strategy,
        executable: input.executable,
        cwd,
        timeoutMs: 30_000,
        environment,
      });
    } else {
      const result = await runProcess({
        executable: input.executable,
        environment,
        arguments: admission.arguments,
        cwd,
        stdin: admission.stdin,
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
      });
      let usage: ProviderJsonUsage | null = null;
      try {
        usage = admission.usage(result.stdout);
      } catch {
        /* Failed native calls may report no usage. */
      }
      await input.observeUsage?.(usage);
      assertKnowledgeProviderAvailable({ strategy: input.strategy, ...result });
      if (result.status !== "completed")
        return {
          admitted: false,
          reason: result.status === "timed_out" ? "probe_timed_out" : "probe_failed",
          exposedTools: [],
        };
      withKnowledgeInvocationFailures(() => admission.assertAdmitted(result.stdout));
    }
    return {
      admitted: true,
      probeResultHash: sha256(
        canonicalJson({
          contract: "adr-0536.v2",
          provider: input.strategy.provider,
          noCapabilities: true,
        }),
      ),
    };
  } catch (error) {
    if (error instanceof KnowledgeProviderAvailabilityError) throw error;
    const failure = error as {
      code?: string;
      exposedTools?: string[];
      probeFailureReason?: "probe_failed" | "probe_timed_out";
    };
    return {
      admitted: false,
      reason:
        failure.probeFailureReason ??
        (failure.code === "knowledge_compile_policy_violation"
          ? "capabilities_exposed"
          : "probe_failed"),
      exposedTools: (failure.exposedTools ?? [])
        .filter((name) =>
          NO_CAPABILITY_PROBE_TOOL_NAMES.includes(
            name as (typeof NO_CAPABILITY_PROBE_TOOL_NAMES)[number],
          ),
        )
        .slice(0, 16),
    };
  }
}
