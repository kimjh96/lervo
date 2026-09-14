import {
  inspectRuntimeExecutable,
  type RuntimeExecutableInspection,
} from "@lervo/adapter-contract";
import { inspectCodexRuntime } from "@lervo/adapter-codex";
import { inspectClaudeRuntime } from "@lervo/adapter-claude";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";

type Readiness = Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;

/**
 * Executable observations supplement, but cannot establish, application permissions or auth.
 * An operating-system permission denial is an observed failure with evidence, not an unobserved probe.
 */
export async function observeSupervisionRuntimeReadiness(input: {
  plan: OperatingActionPlanV1;
  readiness: Readiness;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  now(): string;
}): Promise<Readiness> {
  const readiness = structuredClone(input.readiness);
  const started = input.now();
  const provider = input.plan.provider;
  const configuration = input.configuration;
  const executable =
    provider === "codex" || provider === "claude"
      ? configuration?.providerExecutables[provider]
      : undefined;
  const suites = readiness.responsibility.verificationSuiteIds;
  const mapped =
    configuration !== undefined &&
    suites.every((id) => Object.hasOwn(configuration.verificationTools, id));
  const tools = new Map(
    mapped
      ? suites.flatMap((id) =>
          configuration.verificationTools[id]!.map(
            (tool) => [tool.toolId, tool.executable] as const,
          ),
        )
      : [],
  );
  let observations: {
    provider: RuntimeExecutableInspection | null;
    tools: RuntimeExecutableInspection[];
  };
  try {
    const [providerResult, toolResults] = await Promise.all([
      executable === undefined
        ? null
        : provider === "codex"
          ? inspectCodexRuntime(executable)
          : inspectClaudeRuntime(executable),
      Promise.all(
        [...tools.values()].map((path) =>
          inspectRuntimeExecutable({
            executable: path,
            source: "configured",
          }),
        ),
      ),
    ]);
    observations = { provider: providerResult, tools: toolResults };
  } catch {
    observations = { provider: null, tools: [] };
  }
  const elapsed = Date.parse(input.now()) - Date.parse(started);
  const timely = Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 5000;
  const shellRequired = readiness.responsibility.requiredCapabilities.includes("shell.execute");
  readiness.observation.checks = readiness.observation.checks.map((check) => {
    if (
      check.kind !== "provider" &&
      check.kind !== "tools" &&
      !(check.kind === "cli" && shellRequired)
    )
      return check;
    if (check.status !== "passed" || check.evidenceHash === null) return check;
    const results = check.kind === "provider" ? [observations.provider] : observations.tools;
    const covered =
      check.kind === "provider"
        ? executable !== undefined
        : mapped &&
          observations.tools.length === tools.size &&
          (check.kind !== "cli" || tools.size > 0);
    if (
      timely &&
      covered &&
      results.some((result) => result?.reasonCode === "executable_permission_denied")
    )
      return {
        ...check,
        status: "failed",
        evidenceHash: operatingContractHash({
          adapter: check.evidenceHash,
          permissionFailure: { executable: executable ?? null, tools: [...tools], results },
        }),
      };
    if (
      !timely ||
      !covered ||
      results.some((result) => result === null || result.status !== "available")
    )
      return { ...check, status: "unobserved", evidenceHash: null };
    return {
      ...check,
      evidenceHash: operatingContractHash({
        adapter: check.evidenceHash,
        runtime: { executable: executable ?? null, tools: [...tools], results },
      }),
    };
  });
  return readiness;
}
