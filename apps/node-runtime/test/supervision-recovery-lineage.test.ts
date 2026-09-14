import { expect, it } from "vitest";
import { hasSupervisionRecoveryAncestor } from "../src/supervision-recovery-lineage.js";

it("accepts an intervening unstarted binding only within the current assignment chain", () => {
  const events = [
    {
      eventId: "failed",
      type: "work.responsibility.bound",
      payload: {
        supervisionId: "goal",
        workstreamId: "work",
        assignmentId: "same",
        predecessorBindingHash: "initial",
      },
    },
    {
      eventId: "recovered",
      type: "work.responsibility.bound",
      payload: {
        supervisionId: "goal",
        workstreamId: "work",
        assignmentId: "same",
        predecessorBindingHash: "failed-hash",
      },
    },
    {
      eventId: "revised",
      type: "work.responsibility.bound",
      payload: {
        supervisionId: "goal",
        workstreamId: "work",
        assignmentId: "same",
        predecessorBindingHash: "recovered-hash",
      },
    },
    {
      eventId: "unrelated",
      type: "work.responsibility.bound",
      payload: {
        supervisionId: "goal",
        workstreamId: "work",
        assignmentId: "other",
        predecessorBindingHash: "unrelated-hash",
      },
    },
  ];
  const basis = {
    events,
    supervisionId: "goal",
    workstreamId: "work",
    assignmentId: "same",
    currentBindingEventId: "revised",
  };
  expect(
    hasSupervisionRecoveryAncestor({ ...basis, recoveryResponsibilityHash: "failed-hash" }),
  ).toBe(true);
  expect(
    hasSupervisionRecoveryAncestor({ ...basis, recoveryResponsibilityHash: "unrelated-hash" }),
  ).toBe(false);
  expect(
    hasSupervisionRecoveryAncestor({
      ...basis,
      currentBindingEventId: "recovered",
      recoveryResponsibilityHash: "failed-hash",
    }),
  ).toBe(false);
});
