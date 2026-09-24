import { expect, it } from "vitest";

import { assertSupervisionSourceBinding } from "../src/supervision-source-binding.js";

const current = {
  binding: { authorityDigest: "authority", taskDigest: "task", combined: "combined" },
  authorityDigest: "authority",
  taskDigest: "task",
  planDigest: "combined",
};

it("accepts an unchanged exact admission binding", () => {
  expect(() => assertSupervisionSourceBinding(current)).not.toThrow();
});

it.each([
  [{ ...current, binding: null }, "supervision_authority_unavailable"],
  [{ ...current, authorityDigest: "new-authority" }, "supervision_mandate_source_changed"],
  [{ ...current, taskDigest: "new-task" }, "supervision_task_source_changed"],
  [{ ...current, planDigest: "old-plan" }, "supervision_plan_source_changed"],
] as const)("reports only the changed source boundary", (input, code) => {
  expect(() => assertSupervisionSourceBinding(input)).toThrow(expect.objectContaining({ code }));
});
