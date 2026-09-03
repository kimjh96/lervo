import { randomBytes } from "node:crypto";

import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";

export async function appendLocalVerificationEvidence(input: {
  root: string;
  statuses: Array<"passed" | "failed">;
  startedAt: number;
}): Promise<{ startedAt: string; endedAt: string }> {
  const storage = await openProjectStorage(input.root);
  const completed: string[] = [];
  try {
    const suite = await loadVerificationSuite(input.root, "observation.fixture");
    for (const [index, status] of input.statuses.entries()) {
      let clock = input.startedAt + index * 10;
      const repositoryRevision = sha256(`revision ${index} ${input.startedAt}`);
      const verification = await runVerificationSuite(
        {
          repositoryRoot: input.root,
          repositoryRevision,
          suite,
          artifactStore: storage.artifacts,
          captureRepositoryRevision: async () => repositoryRevision,
        },
        {
          now: () => new Date(clock++),
          environment: { ...process.env, OBSERVATION_FAIL: status === "failed" ? "1" : "0" },
        },
      );
      const identity = randomBytes(8).toString("hex");
      completed.push(verification.result.completedAt);
      storage.events.append({
        eventId: `evt_${identity}`,
        projectId: storage.manifest.projectId,
        runId: `run_${identity}`,
        sessionId: `ses_${identity}`,
        type: "verification.completed",
        occurredAt: verification.result.completedAt,
        actor: { kind: "system" },
        schemaVersion: 1,
        policyVersion: sha256(`policy ${identity}`),
        payload: {
          verificationId: verification.result.verificationId,
          suiteId: verification.result.suiteId,
          suiteHash: verification.result.suiteHash,
          repositoryRevision: verification.result.repositoryRevision,
          status: verification.result.status,
          resultArtifactId: verification.resultArtifact.artifactId,
          resultContentHash: verification.resultArtifact.contentHash,
          nonPassedCommandIds: verification.result.commands
            .filter((command) => command.status !== "passed")
            .map((command) => command.commandId),
        },
      });
    }
  } finally {
    await storage.close();
  }
  return {
    startedAt: completed[0]!,
    endedAt: completed.at(-1)!,
  };
}
