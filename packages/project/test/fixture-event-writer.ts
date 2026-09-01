import { createEventReaderCapabilities } from "@lervo/event-contract";

import { applyEventWriterActivationPlan, planEventWriterActivation } from "../src/index.js";

export async function activateFixtureEventWriterV2(input: {
  repositoryRoot: string;
  projectId: string;
  observedAt: string;
}): Promise<void> {
  const plan = await planEventWriterActivation({
    repositoryRoot: input.repositoryRoot,
    evidence: {
      schemaVersion: 1,
      projectId: input.projectId,
      observedAt: input.observedAt,
      readers: [
        {
          readerId: "reader_local_runtime",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: createEventReaderCapabilities(),
        },
      ],
    },
  });
  if (plan.status !== "ready") throw new Error("The fixture event writer could not activate.");
  await applyEventWriterActivationPlan({ plan, approval: plan.planId });
}
