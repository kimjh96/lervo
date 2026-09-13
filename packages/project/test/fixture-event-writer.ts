import { createEventReaderCapabilities } from "@lervo/event-contract";

import { applyEventWriterActivationPlan, planEventWriterActivation } from "../src/index.js";

interface FixtureWriterInput {
  repositoryRoot: string;
  projectId: string;
  observedAt: string;
}

export function activateFixtureEventWriterV2(input: FixtureWriterInput): Promise<void> {
  return activateFixtureWriter(input, 2);
}

export function activateFixtureEventWriterV3(input: FixtureWriterInput): Promise<void> {
  return activateFixtureWriter(input, 3);
}

async function activateFixtureWriter(
  input: FixtureWriterInput,
  targetEventSchemaVersion: 2 | 3,
): Promise<void> {
  const plan = await planEventWriterActivation({
    targetEventSchemaVersion,
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
  await applyEventWriterActivationPlan({
    plan,
    approval: plan.planId,
    ...(targetEventSchemaVersion === 3 ? { currentEvidence: plan.activationEvidence! } : {}),
  });
}
