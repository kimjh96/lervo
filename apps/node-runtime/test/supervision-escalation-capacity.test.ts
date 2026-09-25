import { expect, it } from "vitest";

import { escalationsSinceLatestInstallation } from "../src/supervision-task-source.js";

it("counts escalations only after the latest reviewed mandate installation", () => {
  const id = "supervision.discord.arca-next.standing";
  const escalation = (seq: number) => ({ seq, type: "work.supervision.escalation.recorded" });
  const installed = (seq: number, supervisionId = id) => ({
    seq,
    type: "work.supervision.mandate.installed",
    payload: { supervisionId },
  });
  const supervisionEvents = [1, 2, 3, 5, 6, 8].map(escalation);
  expect(escalationsSinceLatestInstallation([], supervisionEvents, id)).toBe(6);
  expect(escalationsSinceLatestInstallation([installed(4)], supervisionEvents, id)).toBe(3);
  expect(
    escalationsSinceLatestInstallation([installed(4), installed(7)], supervisionEvents, id),
  ).toBe(1);
  // Another supervision's installation never reopens this one.
  expect(
    escalationsSinceLatestInstallation([installed(7, "supervision.other")], supervisionEvents, id),
  ).toBe(6);
});
