import { expect, it } from "vitest";
import { supervisedFailure } from "../../cli/src/supervised-run-command.js";
import { workerFailureSuffix } from "../src/supervision-managed-process.js";

it("carries the worker CLI's bounded failure reason into the Node's dispatch diagnostics", () => {
  const failure = Object.assign(new Error("The lease\nexpired before start."), {
    code: "assignment_lease_conflict",
  });
  const line = JSON.stringify(supervisedFailure(failure));
  expect(JSON.parse(line)).toEqual({
    code: "supervised_execution_failed",
    reason: "assignment_lease_conflict",
    message: "The lease expired before start.",
  });
  expect(workerFailureSuffix(Buffer.from(`progress\n${line}\n`))).toBe(
    " (worker assignment_lease_conflict: The lease expired before start.)",
  );
  expect(
    JSON.parse(JSON.stringify(supervisedFailure(new TypeError("x".repeat(500))))),
  ).toMatchObject({
    reason: "TypeError",
    message: "x".repeat(200),
  });
  expect(workerFailureSuffix(Buffer.from("not json"))).toBe("");
  expect(workerFailureSuffix(Buffer.alloc(0))).toBe("");
});
