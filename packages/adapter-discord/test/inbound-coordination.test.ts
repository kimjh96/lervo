import { describe, expect, it } from "vitest";

import { mapDiscordInboundCoordination } from "../src/inbound-coordination.js";

describe("Discord inbound coordination", () => {
  it("binds a delegated assignment to its authenticated author", () => {
    expect(
      mapDiscordInboundCoordination({
        coordination: { kind: "task.assignment", taskId: `tsk_${"a".repeat(20)}` },
        actorParticipantId: "ptc_coordinator01",
        primaryMentionedParticipantId: "ptc_worker00001",
      }),
    ).toEqual({
      status: "mapped",
      coordination: {
        kind: "task.assignment",
        taskId: `tsk_${"a".repeat(20)}`,
        coordinatorParticipantId: "ptc_coordinator01",
      },
    });
  });

  it("binds a delegated result to its referenced exact coordinator", () => {
    expect(
      mapDiscordInboundCoordination({
        coordination: { kind: "task.result", taskId: `tsk_${"a".repeat(20)}` },
        actorParticipantId: "ptc_worker00001",
        primaryMentionedParticipantId: "ptc_coordinator01",
      }),
    ).toEqual({
      status: "mapped",
      coordination: {
        kind: "task.result",
        taskId: `tsk_${"a".repeat(20)}`,
        coordinatorParticipantId: "ptc_coordinator01",
      },
    });
  });

  it("fails closed when a coordinated target cannot be mapped", () => {
    expect(
      mapDiscordInboundCoordination({
        coordination: { kind: "task.result", taskId: `tsk_${"a".repeat(20)}` },
        actorParticipantId: "ptc_worker00001",
        primaryMentionedParticipantId: null,
      }),
    ).toEqual({ status: "unmapped" });
  });
});
