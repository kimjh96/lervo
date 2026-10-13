import { SupervisionArtifactReviewJournal } from "@lervo/agent-workforce";
import type {
  OperatingActionPlanV1,
  SupervisedArtifactReviewV1,
} from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionSession } from "./supervision-store.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { observeSupervisionTasks } from "./supervision-task-observation.js";
import { NodeSupervisionError, type NodeSupervisionBinding } from "./supervision-authority.js";

/** Records a reviewed result against canonical task bytes under the current repository owner. */
export async function recordCanonicalArtifactReview(input: {
  storage: ProjectStorage;
  tasks: SupervisionTaskSource;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  effect: SupervisedArtifactReviewV1;
  authorityDigest: string;
  session: Pick<NodeSupervisionSession, "readAuthority">;
  assertOpen: () => void;
  journal: (revision: number) => SupervisionArtifactReviewJournal;
  now: () => string;
}) {
  const plan = structuredClone(input.plan);
  const effect = structuredClone(input.effect);
  const authority = await input.session.readAuthority();
  input.assertOpen();
  if (authority.source.sourceRevisionDigest !== input.authorityDigest)
    throw new NodeSupervisionError("supervision_authority_changed");
  const journal = input.journal(authority.source.workstreamRevision);
  const prior = await journal.inspect(plan, effect);
  if (prior.status === "confirmed") return { eventIds: prior.eventIds };
  const source = await input.tasks.read(operatingDecisionId(plan));
  const assignments = await observeSupervisionTasks(
    source,
    input.storage.artifacts,
    input.binding,
    input.storage.events,
  );
  const assignment = assignments.assignments.find(
    (item) => item.assignmentId === effect.assignmentId,
  );
  if (
    assignment === undefined ||
    plan.graphHash !== source.graph.graphHash ||
    plan.sourceRevisionDigest !==
      operatingContractHash({
        authorityDigest: input.authorityDigest,
        taskDigest: source.sourceRevisionDigest,
      })
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  const current = await input.session.readAuthority();
  const freshSource = await input.tasks.read(operatingDecisionId(plan));
  if (
    current.source.sourceRevisionDigest !== input.authorityDigest ||
    freshSource.sourceRevisionDigest !== source.sourceRevisionDigest
  )
    throw new NodeSupervisionError("supervision_authority_changed");
  return journal.record({
    plan,
    effect,
    assignment,
    validateCurrent: () => {
      input.assertOpen();
      if (
        input.storage.events.latest()?.eventHash !== freshSource.headEventHash ||
        Date.parse(input.now()) >= Date.parse(plan.deadline) ||
        Date.parse(input.now()) >= Date.parse(current.installation.mandate.expiresAt)
      )
        throw new NodeSupervisionError("supervision_authority_changed");
    },
  });
}
