import { claudeJsonUsage } from "./provider-json-usage.js";
import { assertClaudeAdmissionResponse } from "./claude-admission-response.js";
import {
  assertKnowledgeProviderAvailable,
  KnowledgeProviderAvailabilityError,
} from "./provider-availability.js";
import { providerCliDispatchContext } from "./provider-dispatch-context.js";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { assertCodexHasNoModelTools } from "./codex-capability-probe.js";
import type { ProviderJsonUsage } from "./process-provider-contract.js";
import { runProcess } from "./process-host.js";
import { claudeNoCapabilityArguments } from "./no-capability-arguments.js";
import { probeToolNames } from "./probe-tool-names.js";

export type ProviderCliProbeResult =
  | { admitted: true; probeResultHash: string }
  | {
      admitted: false;
      reason: "capabilities_exposed" | "probe_failed" | "probe_timed_out" | "identity_changed";
      exposedTools: string[];
    };

/** The existing run boundary also owns admission. No provider output leaves this adapter. */
export async function probeProviderCli(input: {
  provider: "codex" | "claude";
  executable: string;
  environment?: NodeJS.ProcessEnv;
  observeUsage?: (usage: ProviderJsonUsage | null) => Promise<void>;
}): Promise<ProviderCliProbeResult> {
  const { cwd, environment } = providerCliDispatchContext(input.environment);
  try {
    if (input.provider === "codex") {
      await assertCodexHasNoModelTools({
        executable: input.executable,
        cwd,
        timeoutMs: 30_000,
        environment,
      });
    } else {
      const result = await runProcess({
        executable: input.executable,
        environment,
        arguments: claudeNoCapabilityArguments(),
        cwd,
        stdin: canonicalJson({
          task: "provider_cli_admission_probe",
          instruction:
            'Return exactly {"ok":true}. You have no tools. Do not request or use tools.',
        }),
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
      });
      let usage: ProviderJsonUsage | null = null;
      try {
        usage = claudeJsonUsage(result.stdout);
      } catch {
        /* Failed native calls may report no usage. */
      }
      await input.observeUsage?.(usage);
      assertKnowledgeProviderAvailable({ provider: input.provider, ...result });
      if (result.status !== "completed")
        return {
          admitted: false,
          reason: result.status === "timed_out" ? "probe_timed_out" : "probe_failed",
          exposedTools: [],
        };
      assertClaudeAdmissionResponse(result.stdout);
    }
    return {
      admitted: true,
      probeResultHash: sha256(
        canonicalJson({ contract: "adr-0536.v2", provider: input.provider, noCapabilities: true }),
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
        .filter((name) => probeToolNames.includes(name as (typeof probeToolNames)[number]))
        .slice(0, 16),
    };
  }
}
