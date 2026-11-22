import { describe, expect, it } from "vitest";

import {
  assertHostedLaunchIntent,
  evaluateHostedSessionContract,
  HostedLaunchError,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
} from "../src/index.js";

const capabilities: HostedSessionCapabilities = {
  nativeConversation: true,
  sessionIdBinding: true,
  hooks: false,
  mcp: false,
  systemPromptFile: false,
  resume: false,
};
const sessionId = "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c";

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof HostedLaunchError ? error.code : "uncoded";
  }
}

describe("hosted launch intents", () => {
  const base = {
    sessionId,
    mode: "cli" as const,
    workingDirectory: "/work/repo",
    start: { kind: "new" as const, instruction: "Add a test." },
  };

  it("accepts a well-formed intent", () => {
    expect(codeOf(() => assertHostedLaunchIntent(base, capabilities))).toBeUndefined();
  });

  it("rejects malformed coordinates and undeclared capabilities with stable codes", () => {
    const cases = [
      [{ ...base, sessionId: "ses_1" }, "launch_intent_invalid"],
      [{ ...base, workingDirectory: "repo" }, "launch_intent_invalid"],
      [{ ...base, start: { kind: "new" as const, instruction: "  " } }, "launch_intent_invalid"],
      [{ ...base, start: { kind: "resume" as const } }, "resume_unsupported"],
      [
        { ...base, mode: "native" as const },
        "conversation_mode_unsupported",
        { ...capabilities, nativeConversation: false },
      ],
    ] as const;
    for (const [intent, code, declared] of cases)
      expect(codeOf(() => assertHostedLaunchIntent(intent, declared ?? capabilities))).toBe(code);
  });
});

describe("the common hosted-session checks", () => {
  it("report an adapter that breaks its claims", () => {
    const broken: HostedSessionAdapter = {
      provider: "broken",
      capabilities,
      prepareLaunch: () => ({
        program: "broken",
        arguments: [],
        environment: { BROKEN_API_KEY: "x" },
        workingDirectory: "/elsewhere",
        mode: "cli",
        initialInput: null,
      }),
    };
    const violations = evaluateHostedSessionContract(broken, "/work/repo");
    for (const expected of [
      "the launch changed the conversation mode",
      "the launch changed the working directory",
      "the credential variable BROKEN_API_KEY",
      "does not deliver the instruction",
      "omits the session ID",
      "an undeclared resume launch did not fail",
    ])
      expect(
        violations.some((violation) => violation.includes(expected)),
        expected,
      ).toBe(true);
  });
});
