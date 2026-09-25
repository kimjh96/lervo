import { expect, it } from "vitest";

import { nativeResponsibilityRevision } from "../src/supervision-native-revision.js";
import { InvalidNativeOwnerProposalError } from "../src/supervision-native-task.js";

it("returns a revision of an unclaimed or terminal assignment to the owner as proposal feedback", async () => {
  const input = {
    facts: {
      assignments: [
        { assignmentId: "asn_db18351444e041b0ebe37077", status: "blocked", lease: null },
      ],
      responsibilities: [],
      tasks: { assignments: [] },
    },
    now: () => "2026-09-25T23:30:00.000Z",
  } as unknown as Parameters<typeof nativeResponsibilityRevision>[0];
  const refusal = await nativeResponsibilityRevision(
    input,
    { assignmentId: "asn_db18351444e041b0ebe37077", task: {} },
    `sha256:${"a".repeat(64)}`,
  ).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(InvalidNativeOwnerProposalError);
  expect(refusal).toMatchObject({
    reasonCode: "invalid_task_contract",
    invalidFields: ["assignmentId"],
  });
});
