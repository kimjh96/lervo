import { describe, expect, it } from "vitest";
import { managedExecutionIdentity } from "../src/managed-execution-identity.js";

describe("managed execution identity", () => {
  it("retains one attempt identity across restarts and separates repositories and decisions", () => {
    const key = `sha256:${"a".repeat(64)}`;
    const first = managedExecutionIdentity("prj_Example_01", key);
    expect(managedExecutionIdentity("prj_Example_01", key)).toEqual(first);
    expect(managedExecutionIdentity("prj_Example_02", key)).not.toEqual(first);
    expect(managedExecutionIdentity("prj_Example_01", `sha256:${"b".repeat(64)}`)).not.toEqual(
      first,
    );
    expect(first.runId).toMatch(/^run_[a-f0-9]{32}$/u);
    expect(first.sessionId).toMatch(/^ses_[a-f0-9]{32}$/u);
  });
  it("rejects incomplete or noncanonical identity inputs", () => {
    expect(() => managedExecutionIdentity("prj_short", `sha256:${"a".repeat(64)}`)).toThrow();
    expect(() => managedExecutionIdentity("prj_Example_01", "request prose")).toThrow();
  });
});
