import { createHash } from "node:crypto";

import { readWorkCausalityRecord } from "@lervo/execution-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { type RunCompletedEventPayload, validateSchema } from "@lervo/schemas";
import { collectRunEventsBounded } from "@lervo/storage-contract";

import type { ConversationResultSource } from "./conversation-result-types.js";

const MAXIMUM_MANAGED_RUN_EVENTS = 2_000;

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export class RepositoryConversationResultSource implements ConversationResultSource {
  constructor(
    private readonly repositoryRoot: string,
    private readonly openStorage: (root: string) => Promise<ProjectStorage> = openProjectStorage,
  ) {}

  async read(input: Parameters<ConversationResultSource["read"]>[0]) {
    const storage = await this.openStorage(this.repositoryRoot);
    try {
      const events = collectRunEventsBounded({
        events: storage.events,
        runId: input.runId,
        maximumEvents: MAXIMUM_MANAGED_RUN_EVENTS,
      });
      const completed = events.filter((event) => event.type === "run.completed");
      const captured = events.filter((event) => event.type === "adapter.result.captured");
      const causal = events.filter((event) => event.type === "work.causality.recorded");
      const requested = events.filter((event) => event.type === "run.requested");
      const sessions = new Set(events.map((event) => event.sessionId));
      const causality = causal.length === 1 ? readWorkCausalityRecord(causal[0]!) : null;
      if (
        completed.length !== 1 ||
        captured.length !== 1 ||
        requested.length !== 1 ||
        causality === null ||
        sessions.size !== 1 ||
        !validateSchema("runCompletedEventPayload", completed[0]!.payload).valid ||
        completed[0]!.projectId !== input.origin.target.projectId ||
        requested[0]!.payload.role !== input.origin.roleId ||
        captured[0]!.actor.provider !== input.origin.provider ||
        causality.payload.workstreamId !== input.origin.workstreamId ||
        causality.payload.assignmentId !== input.origin.assignmentId ||
        causality.payload.agentId !== input.origin.agentId
      ) {
        throw new Error("The managed result evidence differs from its conversation origin.");
      }
      const completion = completed[0]!.payload as RunCompletedEventPayload;
      if (completion.verificationStatus !== "passed") {
        throw new Error("The managed result did not pass its required verification.");
      }
      const contentHash = completion.resultDigest;
      const artifactId = `art_${contentHash.slice("sha256:".length)}`;
      if (!completion.artifactIds.includes(artifactId)) {
        throw new Error("The managed completion event does not name its result artifact.");
      }
      const uri = `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
      const bytes = new Uint8Array(await storage.artifacts.get(uri));
      if (bytes.byteLength < 1 || digest(bytes) !== contentHash) {
        throw new Error("The managed result artifact differs from its completion event.");
      }
      return {
        runId: input.runId,
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    } finally {
      await storage.close();
    }
  }
}
