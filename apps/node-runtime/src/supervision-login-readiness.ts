import { inspectCodexLogin } from "@lervo/adapter-codex";
import { inspectClaudeLogin } from "@lervo/adapter-claude";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";

type Readiness = Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;

/** A permission-denied login probe records an observed failure; other misses stay unobserved. */
export async function observeSupervisionLoginReadiness(input: {
  plan: OperatingActionPlanV1;
  readiness: Readiness;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  now(): string;
}): Promise<Readiness> {
  const readiness = structuredClone(input.readiness);
  const check = readiness.observation.checks.find((item) => item.kind === "provider");
  if (check?.status !== "passed" || check.evidenceHash === null) return readiness;
  const started = input.now();
  try {
    const provider = input.plan.provider;
    if (provider !== "codex" && provider !== "claude")
      throw new Error("Unsupported login observation.");
    const executable = input.configuration?.providerExecutables[provider];
    const context = input.configuration?.providerLoginContexts?.[provider];
    if (executable === undefined || context === undefined)
      throw new Error("Missing login context.");
    const result = await (provider === "codex"
      ? inspectCodexLogin(executable, context)
      : inspectClaudeLogin(executable, context));
    const elapsed = Date.parse(input.now()) - Date.parse(started);
    if (
      result.reasonCode === "executable_permission_denied" &&
      Number.isFinite(elapsed) &&
      elapsed >= 0 &&
      elapsed <= 5000
    ) {
      check.status = "failed";
      check.evidenceHash = operatingContractHash({
        adapter: check.evidenceHash,
        permissionFailure: { executable, context, result },
      });
      return readiness;
    }
    if (
      result.status !== "login_present" ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed > 5000
    )
      throw new Error("Login is not observed.");
    check.evidenceHash = operatingContractHash({
      adapter: check.evidenceHash,
      login: { executable, context, result },
    });
  } catch {
    check.status = "unobserved";
    check.evidenceHash = null;
  }
  return readiness;
}
