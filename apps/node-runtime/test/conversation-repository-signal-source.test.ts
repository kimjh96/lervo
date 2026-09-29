import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { ConversationInboundEvent, EventEnvelope } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileConversationRepositorySignalCursor } from "../src/conversation-repository-signal-cursor.js";
import { RepositoryConversationSignalSource } from "../src/conversation-repository-signal-source.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

afterEach(removeTemporaryRoots);

function event(seq: number, type: string): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `evt_repository_signal_${seq}`,
    projectId: "prj_node_runtime_01",
    runId: "run_repository_signal_01",
    sessionId: "ses_repository_signal_01",
    seq,
    type,
    occurredAt: `2026-09-09T00:00:0${seq}.000Z`,
    actor: { kind: "system" },
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: { privateValue: "must-not-cross" },
    previousHash: null,
    eventHash: `sha256:${"b".repeat(64)}`,
  } as EventEnvelope;
}

describe("repository conversation signal source", () => {
  it("starts at the current head and dispatches each later mapped event exactly once", async () => {
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const values = [event(1, "run.requested")];
    const dispatch = vi.fn<(event: ConversationInboundEvent) => Promise<void>>(
      async () => undefined,
    );
    const cursorPath = resolve(root, "cursor.json");
    const createSource = () =>
      new RepositoryConversationSignalSource({
        projectId: "prj_node_runtime_01",
        integrationId: "itg_discord01",
        conversationIds: ["cnv_operator01"],
        mappings: [{ eventType: "run.completed", signalCode: "work.completed" }],
        events: {
          latest: () => values.at(-1) ?? null,
          list: ({ afterSeq = 0, limit = 100 } = {}) =>
            values.filter((item) => item.seq > afterSeq).slice(0, limit),
        },
        artifacts,
        cursor: new FileConversationRepositorySignalCursor(cursorPath, {
          projectId: "prj_node_runtime_01",
          integrationId: "itg_discord01",
        }),
        dispatch,
        now: () => new Date("2026-09-09T00:01:00.000Z"),
      });

    await expect(createSource().runCycle()).resolves.toEqual({ status: "idle", eventCount: 0 });
    values.push(event(2, "run.completed"));
    const source = createSource();
    await expect(source.runCycle()).resolves.toEqual({ status: "processed", eventCount: 1 });
    await expect(source.runCycle()).resolves.toEqual({ status: "idle", eventCount: 0 });
    await expect(createSource().runCycle()).resolves.toEqual({ status: "idle", eventCount: 0 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const raised = dispatch.mock.calls[0]![0];
    expect(raised).toMatchObject({
      kind: "signal.raised",
      signalCode: "work.completed",
      actor: { kind: "system", participantId: "ptc_lervo_system" },
      target: { conversationId: "cnv_operator01" },
    });
    const body = Buffer.from(
      await artifacts.get(
        `lervo-cas://sha256/${raised.content.contentHash.slice("sha256:".length)}`,
      ),
    ).toString("utf8");
    expect(body).toContain("run.completed");
    expect(body).not.toContain("must-not-cross");
  });

  it("does not start a proactive conversation for an assignment completion", async () => {
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const values = [event(1, "run.requested")];
    const dispatch = vi.fn<(event: ConversationInboundEvent) => Promise<void>>(
      async () => undefined,
    );
    const source = new RepositoryConversationSignalSource({
      projectId: "prj_node_runtime_01",
      integrationId: "itg_discord01",
      conversationIds: ["cnv_operator01"],
      mappings: [
        { eventType: "assignment.completed", signalCode: "work.completed" },
        { eventType: "assignment.handoff.recorded", signalCode: "assignment.attention" },
      ],
      events: {
        latest: () => values.at(-1) ?? null,
        list: ({ afterSeq = 0, limit = 100 } = {}) =>
          values.filter((item) => item.seq > afterSeq).slice(0, limit),
      },
      artifacts,
      cursor: new FileConversationRepositorySignalCursor(resolve(root, "cursor.json"), {
        projectId: "prj_node_runtime_01",
        integrationId: "itg_discord01",
      }),
      dispatch,
      now: () => new Date("2026-09-09T00:01:00.000Z"),
    });

    await source.runCycle();
    values.push(event(2, "assignment.completed"));
    await expect(source.runCycle()).resolves.toEqual({ status: "processed", eventCount: 1 });
    expect(dispatch).not.toHaveBeenCalled();

    values.push(event(3, "assignment.handoff.recorded"));
    await source.runCycle();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].signalCode).toBe("assignment.attention");
  });
});
