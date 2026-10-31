import {
  applyWorkstreamUpdatePlan,
  createWorkstreamUpdatePlan,
  readCurrentWorkstream,
  sha256,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";

/** One ordinary workstream decision covers every waiting skill; it never expands its own scope. */
export async function requestPracticeWriteScope(context: InstructionCaptureContext): Promise<void> {
  const root = context.storage.paths.repositoryRoot;
  const snapshot = await readCurrentWorkstream(root);
  if (!snapshot) return;
  const decisionId = `wdec_${sha256("practice-learning:.agents/skills").slice(7, 23)}`;
  if (
    snapshot.pendingDecisions?.some((d) => d.decisionId === decisionId) ||
    (snapshot.pendingDecisions?.length ?? 0) >= 8
  )
    return;
  const plan = await createWorkstreamUpdatePlan({
    repositoryRoot: root,
    projectId: context.storage.manifest.projectId,
    snapshot: {
      ...snapshot,
      revision: snapshot.revision + 1,
      updatedAt: context.now().toISOString(),
      pendingDecisions: [
        ...(snapshot.pendingDecisions ?? []),
        {
          decisionId,
          question:
            "Allow reviewed practice skills by adding .agents/skills to the convergence delegation normalization roots?",
          choices: [
            {
              choiceId: "extend",
              label: "Review the scope change",
              consequence: "A reviewed delegation may publish accepted skills.",
            },
            {
              choiceId: "keep",
              label: "Keep the current scope",
              consequence: "All practice skill writes keep waiting.",
            },
          ],
          recommendedChoiceId: "extend",
          blocking: false,
        },
      ],
    },
  });
  if (plan.status !== "ready") return;
  await applyWorkstreamUpdatePlan({
    plan,
    actor: "agent",
    now: context.now(),
    recordApplied: (receipt) => {
      const id = sha256(receipt.snapshotContentHash).slice(7, 39);
      context.storage.events.append({
        eventId: `evt_${id}`,
        projectId: context.storage.manifest.projectId,
        runId: `run_${id}`,
        sessionId: `ses_${id}`,
        actor: { kind: "system" },
        schemaVersion: 4,
        type: "workstream.snapshot.recorded",
        policyVersion: sha256("practice-scope-decision.v1"),
        occurredAt: receipt.appliedAt,
        payload: { ...receipt },
      });
    },
  });
}
