import { rm } from "node:fs/promises";

import { createEventReaderCapabilities } from "@lervo/event-contract";
import { applyEventWriterActivationPlan, planEventWriterActivation } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import { installationFixture, supervisionId } from "../../cli/test/mandate-installation.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("installs the same reviewed supervision mandate after reader-first writer-4 activation", async () => {
  const fixture = await installationFixture(roots);
  const evidence = {
    schemaVersion: 1 as const,
    projectId: fixture.owner.projectId,
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_local_runtime",
        readerKind: "local" as const,
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const activation = await planEventWriterActivation({
    repositoryRoot: fixture.root,
    evidence,
    targetEventSchemaVersion: 4,
  });
  await applyEventWriterActivationPlan({
    plan: activation,
    approval: activation.planId,
    currentEvidence: evidence,
  });
  const plan = await createRepositoryMandatePlan({
    ...fixture,
    supervisionId,
    reviewerId: fixture.mandate.appointingAuthorityId,
  });
  const installed = await installRepositoryMandate({
    root: fixture.root,
    plan,
    approval: plan.approvalHash,
    reviewerId: fixture.mandate.appointingAuthorityId,
  });
  expect(installed).toMatchObject({
    mandate: { ownerAgentId: fixture.owner.agentId },
    revoked: false,
  });
});
