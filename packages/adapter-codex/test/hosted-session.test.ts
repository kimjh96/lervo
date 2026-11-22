import { evaluateHostedSessionContract, HostedLaunchError } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { createCodexHostedSessionAdapter } from "../src/index.js";

const sessionId = "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c";
const adapter = createCodexHostedSessionAdapter("/opt/codex");

describe("Codex CLI hosted sessions", () => {
  it("passes the common hosted-session checks", () => {
    expect(evaluateHostedSessionContract(adapter, "/work/repo")).toEqual([]);
  });

  it("starts the CLI conversation with the instruction as its prompt", () => {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode: "cli",
      workingDirectory: "/work/repo",
      start: { kind: "new", instruction: "Fix the build." },
    });
    expect([launch.program, ...launch.arguments]).toEqual(["/opt/codex", "Fix the build."]);
  });

  it("declines the native conversation until its decoder is proven", () => {
    expect(() =>
      adapter.prepareLaunch({
        sessionId,
        mode: "native",
        workingDirectory: "/work/repo",
        start: { kind: "new", instruction: "Fix the build." },
      }),
    ).toThrow(HostedLaunchError);
  });
});
