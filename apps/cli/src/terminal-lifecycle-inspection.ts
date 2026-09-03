import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import { inspectTerminalIntegration } from "@lervo/repository-knowledge";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import {
  inspectTerminalRuntimeActivation,
  readTerminalActivationReceipts,
  terminalActivationReadiness,
} from "./terminal-activation-state.js";
import type {
  PreparedTerminalTurnExpectation,
  TerminalLifecycleInspection,
} from "./terminal-hook-contract.js";
import { inspectTerminalRepositoryKnowledgeLifecycle } from "./terminal-knowledge-lifecycle-inspection.js";
import {
  latestTerminalTurnDeclaration,
  terminalDeliberationDeclarationMatches,
} from "./terminal-turn-observation.js";
import { inspectTerminalWorkspace } from "./terminal-workspace-lifecycle.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export async function inspectTerminalLifecycle(
  root: string,
  expected?: PreparedTerminalTurnExpectation,
): Promise<TerminalLifecycleInspection> {
  const [supplementalSources, currentRepository] = await Promise.all([
    collectLocalKnowledgeSources(root),
    captureRepositorySnapshot(root),
  ]);
  const repositoryChange = {
    beforeRevision: expected?.repositoryRevision ?? currentRepository.revision,
    afterRevision: currentRepository.revision,
    changed: expected !== undefined && expected.repositoryRevision !== currentRepository.revision,
  };
  const issues: TerminalLifecycleInspection["issues"] = [];
  let workspace: TerminalLifecycleInspection["workspace"] = null;
  if (expected?.workspaceBinding !== null && expected?.workspaceBinding !== undefined) {
    workspace = await inspectTerminalWorkspace({
      root,
      provider: expected.provider,
      providerSessionId: expected.providerSessionId,
      binding: expected.workspaceBinding,
    });
    issues.push(...workspace.issues);
    if (expected.workspaceBinding.executionKind === "worker") {
      const activation = await readTerminalActivationReceipts(root);
      const runtimeActivation = await inspectTerminalRuntimeActivation(root, activation);
      return {
        schemaVersion: 1,
        status: issues.length === 0 ? "current" : "action_required",
        repositoryRoot: root,
        issues,
        activation,
        runtimeActivation,
        activationReadiness: terminalActivationReadiness(runtimeActivation),
        repositoryChange,
        workspace,
      };
    }
  }
  try {
    const handoff = await lstat(resolve(root, "HANDOFF.md"));
    if (handoff.isFile() && !handoff.isSymbolicLink())
      issues.push({ code: "legacy_root_handoff_pending", command: "lervo migrate knowledge" });
    else
      issues.push({
        code: "legacy_root_handoff_unsafe",
        command: "review HANDOFF.md and run lervo migrate knowledge",
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const workstreamStorage = await openProjectStorage(root);
  try {
    const current = await verifiedCurrentWorkstream(workstreamStorage);
    const checkpointRequired = expected === undefined || repositoryChange.changed;
    if (checkpointRequired && current === null) {
      issues.push({ code: "workstream_missing", command: "lervo workstream start --stdin" });
    } else if (checkpointRequired && expected !== undefined && current !== null) {
      if (expected.workstreamId !== null && current.workstreamId !== expected.workstreamId) {
        issues.push({
          code: "workstream_identity_changed",
          command: "lervo workstream current --json",
        });
      } else if (expected.revision !== null && current.revision <= expected.revision) {
        issues.push({
          code: "workstream_checkpoint_required",
          command: "lervo workstream update --stdin",
        });
      }
    }
    if (expected !== undefined && repositoryChange.changed) {
      const declaration = latestTerminalTurnDeclaration(
        workstreamStorage.events,
        expected.contextEventId,
        expected.provider,
      );
      if (declaration === null) {
        issues.push({
          code: "turn_declaration_missing",
          command: `lervo terminal declare --provider ${expected.provider} --observation ${expected.observationId} --stdin`,
        });
      } else {
        if (declaration.payload.repositoryRevision !== currentRepository.revision) {
          issues.push({
            code: "turn_declaration_stale",
            command: `lervo terminal declare --provider ${expected.provider} --observation ${expected.observationId} --stdin`,
          });
        }
        if (declaration.payload.canonicalizationDisposition === "not_applicable_read_only") {
          issues.push({
            code: "canonicalization_disposition_invalid",
            command: "review canonical repository sources and redeclare the turn",
          });
        }
        if (declaration.payload.knowledgeDisposition === "not_applicable_read_only") {
          issues.push({
            code: "knowledge_disposition_invalid",
            command: "run lervo migrate knowledge and redeclare the turn",
          });
        }
        if (
          declaration.payload.canonicalizationDisposition === "pending_user_approval" ||
          declaration.payload.knowledgeDisposition === "pending_user_approval"
        ) {
          issues.push({
            code: "turn_approval_pending",
            command:
              "obtain the required user decision before applying or completing the repository change",
          });
        }
        if (
          !terminalDeliberationDeclarationMatches(workstreamStorage.events, declaration.payload)
        ) {
          issues.push({
            code: "deliberation_declaration_invalid",
            command: "complete or accurately redeclare the requested deliberation lifecycle",
          });
        }
      }
    }
  } catch {
    issues.push({ code: "workstream_state_invalid", command: "lervo workstream current --json" });
  } finally {
    await workstreamStorage.close();
  }
  const terminal = await inspectTerminalIntegration(root);
  if (terminal.status !== "current")
    issues.push({
      code:
        terminal.status === "blocked"
          ? "terminal_integration_blocked"
          : "terminal_integration_stale",
      command: "lervo migrate knowledge",
    });
  issues.push(
    ...(await inspectTerminalRepositoryKnowledgeLifecycle({
      root,
      repositoryRevision: currentRepository.revision,
      supplementalSources,
    })),
  );
  const activation = await readTerminalActivationReceipts(root);
  const runtimeActivation = await inspectTerminalRuntimeActivation(root, activation);
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "current" : "action_required",
    repositoryRoot: root,
    issues,
    activation,
    runtimeActivation,
    activationReadiness: terminalActivationReadiness(runtimeActivation),
    repositoryChange,
    workspace,
  };
}
