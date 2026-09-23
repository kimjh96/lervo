import { inspectSupervisionPathAccess } from "./supervision-path-access.js";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import { operatingContractHash } from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";
import { readSupervisionAssignmentSource } from "./supervision-assignment-source.js";
import { readSupervisionWorkspaceSource } from "./supervision-workspace-source.js";
import type { ProjectStorage } from "@lervo/project-storage";

export async function observeSupervisionRepositoryReadiness(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  readiness: Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;
  now(): string;
  workspaceEvidenceStorage: ProjectStorage;
}) {
  const started = input.now();
  const readiness = structuredClone(input.readiness);
  try {
    const eventHeadHash = input.workspaceEvidenceStorage.events.latest()?.eventHash ?? null;
    const coordinates = {
      repositoryRoot: input.repositoryRoot,
      plan: input.plan,
      responsibility: readiness.responsibility,
    };
    const before = await readSupervisionAssignmentSource({ ...coordinates, now: started });
    const workspace = await readSupervisionWorkspaceSource(
      input.repositoryRoot,
      before.assignment,
      input.plan,
      input.workspaceEvidenceStorage,
    );
    for (const check of readiness.observation.checks) {
      if (
        (check.kind !== "read_scope" && check.kind !== "write_scope") ||
        check.status !== "passed" ||
        check.evidenceHash === null
      )
        continue;
      try {
        const access = await inspectSupervisionPathAccess(
          workspace.workspacePath,
          [...new Set([...input.plan.expectedPaths, ...readiness.responsibility.expectedPaths])],
          check.kind === "read_scope" ? "read" : "write",
        );
        check.evidenceHash = operatingContractHash({ adapter: check.evidenceHash, access });
      } catch {
        check.status = "unobserved";
        check.evidenceHash = null;
      }
    }
    const after = await readSupervisionAssignmentSource({ ...coordinates, now: input.now() });
    const elapsed = Date.parse(input.now()) - Date.parse(started);
    if (
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed > 5000 ||
      (input.workspaceEvidenceStorage.events.latest()?.eventHash ?? null) !== eventHeadHash ||
      before.leaseHash !== after.leaseHash ||
      before.ancestryHash !== after.ancestryHash
    )
      throw new NodeSupervisionError("supervision_readiness_changed");
    const evidence = {
      lease: after.leaseHash,
      ancestry: after.ancestryHash,
      workspace: workspace.evidenceHash,
    };
    readiness.observation.checks = readiness.observation.checks.map((check) => {
      if (check.kind !== "lease" && check.kind !== "ancestry" && check.kind !== "workspace")
        return check;
      if (check.status !== "passed" || check.evidenceHash === null) return check;
      return {
        ...check,
        evidenceHash: operatingContractHash({
          adapter: check.evidenceHash,
          repository: evidence[check.kind],
        }),
      };
    });
    return readiness;
  } catch {
    return {
      ...readiness,
      observation: {
        ...readiness.observation,
        checks: readiness.observation.checks.map((check) =>
          ["lease", "ancestry", "workspace", "read_scope", "write_scope"].includes(check.kind) &&
          check.status === "passed"
            ? { ...check, status: "unobserved" as const, evidenceHash: null }
            : check,
        ),
      },
    };
  }
}
