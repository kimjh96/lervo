import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { listAssignments, listAgents } from "@lervo/agent-workforce";
import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { CONVERGENCE_DELEGATION_PATH, parseConvergenceDelegation } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";

function bytes(path: string): Buffer {
  if (lstatSync(path).isSymbolicLink() || lstatSync(dirname(path)).isSymbolicLink())
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Capture after asynchronous role/ancestry checks; compare exact state again inside the event transaction. */
export async function captureConvergenceSettlementAuthority(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
): Promise<void> {
  if (state.baseline.delegationHash === null || !state.receipts.length) {
    delete context.settlementAuthority;
    return;
  }
  const home = await resolveRepositoryCoordinationHome(context.storage.paths.repositoryRoot, {
    readOnly: true,
  });
  const paths = [resolve(home.workforce, "agents.json")];
  const closed = state.stageData.settledAssignment as
    | { assignmentId: string; agentId: string; inputArtifactHash: string; status: string }
    | undefined;
  if (closed) {
    const [assignments, agents] = await Promise.all([
      listAssignments(context.storage.paths.repositoryRoot),
      listAgents(context.storage.paths.repositoryRoot),
    ]);
    const assignment = assignments.find((item) => item.assignmentId === closed.assignmentId);
    if (
      assignment?.status !== closed.status ||
      assignment.assigneeAgentId !== closed.agentId ||
      assignment.convergence?.inputArtifactHash !== closed.inputArtifactHash ||
      !agents.some((agent) => agent.agentId === closed.agentId && agent.status === "active")
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    paths.push(resolve(home.workforce, "assignments", `${closed.assignmentId}.json`));
  }
  context.settlementAuthority = {
    obligationId: state.obligationId,
    snapshotHash: state.snapshotHash,
    files: paths.map((path) => ({ path, contentHash: sha256(bytes(path)) })),
  };
}

export function assertConvergenceSettlementAuthority(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
): void {
  if (state.baseline.delegationHash === null || !state.receipts.length) return;
  const raw = bytes(resolve(context.storage.paths.repositoryRoot, CONVERGENCE_DELEGATION_PATH));
  const delegation = parseConvergenceDelegation(
    JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(raw)),
  );
  if (
    sha256(raw) !== state.baseline.delegationHash ||
    delegation.state !== "active" ||
    Date.parse(delegation.expiresAt) <= Date.now()
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  resolveConvergenceAssetDispositions(context.storage.paths.repositoryRoot, delegation);
  const fence = context.settlementAuthority;
  if (
    !fence ||
    fence.obligationId !== state.obligationId ||
    fence.snapshotHash !== state.snapshotHash ||
    fence.files.some((file) => sha256(bytes(file.path)) !== file.contentHash)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
}
