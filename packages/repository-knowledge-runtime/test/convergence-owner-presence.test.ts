import { expect, it } from "vitest";

import { verdictFromHubDecision } from "../src/convergence-owner-verdict.js";

const lease = {
  schemaVersion: 1 as const,
  projectId: "prj_presence_verdict",
  repositoryIdentityHash: `sha256:${"1".repeat(64)}`,
  holderHostHash: `sha256:${"2".repeat(64)}`,
  holderLabel: "mac",
  generation: 3,
  acquiredAt: "2026-11-21T00:00:00.000Z",
  renewedAt: "2026-11-21T00:00:00.000Z",
  expiresAt: "2026-11-21T00:30:00.000Z",
  releasedAt: null,
};
const verdict = (holderPresent?: boolean) =>
  verdictFromHubDecision({
    decision: {
      status: "held_elsewhere",
      lease,
      hubTime: "2026-11-21T00:10:00.000Z",
      ...(holderPresent === undefined ? {} : { holderPresent }),
    },
    requestStartedAt: Date.parse("2026-11-21T00:10:00.000Z"),
    observedAt: Date.parse("2026-11-21T00:10:00.000Z"),
    host: { hostHash: `sha256:${"3".repeat(64)}`, hostLabel: "wsl" },
  });

it("arms no expiry wake while the Hub reports the holder present (ADR-0602)", () => {
  // The Hub keeps a present holder's lease live and pushes its departure.
  expect(verdict(true)).toMatchObject({ role: "waiting_owner", wakeAt: null });
  // A holder that left, or a Hub older than ADR-0602: wake at the exact expiry.
  expect(verdict(false).wakeAt).toBe("2026-11-21T00:30:05.000Z");
  expect(verdict().wakeAt).toBe("2026-11-21T00:30:05.000Z");
});
