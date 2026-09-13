import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import { inspectCodexLogin, inspectCodexRuntime } from "@lervo/adapter-codex";
import { inspectClaudeLogin, inspectClaudeRuntime } from "@lervo/adapter-claude";
import { operatingContractHash, selectWorkforceAllocation } from "@lervo/work-controller";
import { loadSupervisionPlanningContext } from "./supervision-planning-context.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";
import {
  snapshotRuntimeReadinessConfiguration,
  type NodeRuntimeReadinessConfiguration,
} from "./supervision-runtime-configuration.js";

/** Builds a grounded staffing rationale; later action review owns every mutation and dispatch. */
export async function prepareSupervisionWorkforcePlan(input: {
  repositoryRoot: string;
  projectId: string;
  workstreamId: string;
  workstreamRevision: number;
  ownerAgentId: string;
  provider: "codex" | "claude";
  responsibility: WorkResponsibilityV1;
  settledPredecessor?: { assignmentHash: string; leaseId: string };
  configuration: NodeRuntimeReadinessConfiguration;
  now(): string;
}) {
  const configuration = snapshotRuntimeReadinessConfiguration(input.configuration)!;
  const task = structuredClone(input.responsibility);
  const context = await loadSupervisionPlanningContext({
    ...input,
    purpose: task.taskPurpose,
    expectedPaths: task.expectedPaths,
  });
  const executable = configuration.providerExecutables[input.provider];
  const loginContext = configuration.providerLoginContexts?.[input.provider];
  const started = input.now();
  const environment =
    executable === undefined || loginContext === undefined
      ? null
      : await Promise.all([
          input.provider === "codex"
            ? inspectCodexRuntime(executable)
            : inspectClaudeRuntime(executable),
          input.provider === "codex"
            ? inspectCodexLogin(executable, loginContext)
            : inspectClaudeLogin(executable, loginContext),
        ]);
  const elapsed = Date.parse(input.now()) - Date.parse(started);
  const observed =
    environment !== null && Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 5000;
  const status = !observed
    ? "unobserved"
    : environment[0].status === "available" && environment[1].status === "login_present"
      ? "ready"
      : "failed";
  const workforce = await observeSupervisionWorkforce({ ...input, responsibility: task });
  const selection = selectWorkforceAllocation({
    sourceHash: workforce.sourceHash,
    candidates: workforce.candidates,
    environment: status,
  });
  const evidence = {
    schemaVersion: 1,
    kind: "workforce.grounded_plan",
    responsibilityHash: operatingContractHash(task),
    contextHash: context.contextHash,
    workforceSourceHash: workforce.sourceHash,
    environment: {
      status,
      evidenceHash: operatingContractHash({
        executable: executable ?? null,
        context: loginContext ?? null,
        observations: environment,
      }),
    },
    selection,
  };
  return { context, workforce, selection, evidence, planHash: operatingContractHash(evidence) };
}
