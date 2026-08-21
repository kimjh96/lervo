import { createHash } from "node:crypto";

import type {
  ConversationDeliberationReconciliationTarget,
  ConversationDeliberationReconciliationReason,
  ConversationDeliberationReconciliationSourcePort,
} from "@lervo/conversation-control";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";

import {
  inspectManagedDeliberation,
  type DeliberationInspectionReport,
} from "./deliberation-inspection.js";
import {
  ManagedConversationDeliberationProjects,
  type ManagedConversationDeliberationProjectBinding,
} from "./conversation-deliberation-projects.js";

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

type ReconciliationSourceResult = Awaited<ReturnType<
  ConversationDeliberationReconciliationSourcePort["inspect"]
>>;

export function interpretManagedDeliberationInspection(input: {
  job: Readonly<ConversationDeliberationReconciliationTarget>;
  inspectedAt: string;
  report: DeliberationInspectionReport;
}): ReconciliationSourceResult {
  const { job, report } = input;
  if (
    report.projectId !== job.projectId || report.deliberationId !== job.deliberationId ||
    report.sourceStatus === "inconsistent"
  ) return { status: "not_confirmed", reason: "source_inconsistent" };
  if (report.sourceStatus === "incomplete") {
    return { status: "not_confirmed", reason: "history_incomplete" };
  }
  const evidenceHash = digest({
    schemaVersion: 1,
    inspectedAt: input.inspectedAt,
    report,
  });
  if (report.phase === "completed" && report.completionStatus !== null) {
    return {
      status: "confirmed",
      sourceKind: "managed_deliberation_inspection_v1",
      evidenceHash,
      summary: {
        deliberationId: report.deliberationId,
        status: report.completionStatus,
        artifactCount: report.artifactCount,
        nextAction: "none",
      },
    };
  }
  if (
    report.phase === "interrupted_after_approval" &&
    job.operation === "start" &&
    report.resume === "candidate" && report.checkpoint === "readable" &&
    report.lease !== "active"
  ) {
    return {
      status: "confirmed",
      sourceKind: "managed_deliberation_inspection_v1",
      evidenceHash,
      summary: {
        deliberationId: report.deliberationId,
        status: "interrupted",
        artifactCount: report.artifactCount,
        nextAction: "resume",
      },
    };
  }
  return {
    status: "not_confirmed",
    reason: report.lease === "active" ? "active_execution" : "history_incomplete",
  };
}

export function createManagedConversationDeliberationReconciliationSource(options: {
  projects: readonly ManagedConversationDeliberationProjectBinding[];
  openStorage?: (repositoryRoot: string) => Promise<ProjectStorage>;
  inspect?: typeof inspectManagedDeliberation;
}): ConversationDeliberationReconciliationSourcePort {
  const projects = new ManagedConversationDeliberationProjects(options.projects);
  const openStorage = options.openStorage ?? openProjectStorage;
  const inspect = options.inspect ?? inspectManagedDeliberation;
  return {
    async inspect(input) {
      const repositoryRoot = projects.require(input.job.projectId);
      let storage: ProjectStorage | undefined;
      try {
        storage = await openStorage(repositoryRoot);
        if (storage.manifest.projectId !== input.job.projectId) {
          return { status: "not_confirmed", reason: "source_inconsistent" };
        }
        let report: DeliberationInspectionReport;
        try {
          report = await inspect({
            storage,
            deliberationId: input.job.deliberationId,
          });
        } catch (error) {
          const code = (error as { code?: unknown } | null)?.code;
          const reason: ConversationDeliberationReconciliationReason =
            code === "deliberation_not_found" ? "source_not_found" : "source_inconsistent";
          return { status: "not_confirmed", reason };
        }
        return interpretManagedDeliberationInspection({
          job: input.job,
          inspectedAt: input.inspectedAt,
          report,
        });
      } finally {
        await storage?.close();
      }
    },
  };
}
