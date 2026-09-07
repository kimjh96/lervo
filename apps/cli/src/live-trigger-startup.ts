import type { LiveWebhookAuthorizationV1 } from "@lervo/live-trigger-contract";
import { openProjectStorage } from "@lervo/project-storage";

import { verifiedCurrentWorkstream } from "./workstream-services.js";

export async function validateLiveTriggerStartupTarget(input: {
  repositoryRoot: string;
  authorization: LiveWebhookAuthorizationV1;
}): Promise<void> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (
      storage.manifest.projectId !== input.authorization.projectId ||
      workstream === null ||
      workstream.status !== "active" ||
      workstream.workstreamId !== input.authorization.workstreamId
    ) {
      throw new Error(
        "The live webhook authorization does not match this project and its active workstream.",
      );
    }
  } finally {
    await storage.close();
  }
}
