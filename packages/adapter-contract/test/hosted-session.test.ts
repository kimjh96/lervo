import { describe, expect, it } from "vitest";

import {
  assertHostedLaunchIntent,
  evaluateHostedSessionContract,
  HostedLaunchError,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
  hostedConversationModes,
  preferredConversationMode,
} from "../src/index.js";

const capabilities: HostedSessionCapabilities = {
  nativeConversation: true,
  sessionIdBinding: true,
  hooks: false,
  mcp: false,
  systemPromptFile: false,
  resume: false,
  readAccess: false,
  questions: false,
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

describe("the preferred conversation", () => {
  it("is native when the provider offers it and the CLI otherwise", () => {
    expect(preferredConversationMode(capabilities)).toBe("native");
    expect(preferredConversationMode({ ...capabilities, nativeConversation: false })).toBe("cli");
    expect(hostedConversationModes(capabilities)).toEqual(["native", "cli"]);
    expect(hostedConversationModes({ ...capabilities, nativeConversation: false })).toEqual([
      "cli",
    ]);
  });
});

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
      [{ ...base, access: "read" as const }, "access_unsupported"],
      [
        { ...base, mode: "native" as const },
        "conversation_mode_unsupported",
        { ...capabilities, nativeConversation: false },
      ],
      [
        { ...base, hooks: { settingsPath: "/s.json", command: "lervo hook" } },
        "launch_intent_invalid",
      ],
      [
        { ...base, hooks: { settingsPath: "s.json", command: "lervo hook" } },
        "launch_intent_invalid",
        { ...capabilities, hooks: true },
      ],
      [
        { ...base, hooks: { settingsPath: "/s.json", command: "lervo hook\nrm -rf /" } },
        "launch_intent_invalid",
        { ...capabilities, hooks: true },
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
      displayName: " Broken ",
      capabilities,
      prepareLaunch: () => ({
        program: "broken",
        arguments: [],
        environment: { BROKEN_API_KEY: "x" },
        workingDirectory: "/elsewhere",
        mode: "cli",
        initialInput: null,
        environmentRemove: [],
        settingsFile: null,
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
      "an undeclared read-access launch did not fail",
      "the display name must be 1 to 64 characters",
      "undeclared hooks did not fail",
    ])
      expect(
        violations.some((violation) => violation.includes(expected)),
        expected,
      ).toBe(true);
  });

  it("report a read-access claim whose read launch is the write launch", () => {
    const same: HostedSessionAdapter = {
      provider: "same",
      displayName: "Same",
      capabilities: { ...capabilities, readAccess: true },
      prepareLaunch: (intent) => ({
        program: "same",
        arguments: ["--session-id", intent.sessionId],
        environment: {},
        workingDirectory: intent.workingDirectory,
        mode: intent.mode,
        initialInput: intent.start.kind === "new" ? intent.start.instruction : null,
        environmentRemove: [],
        settingsFile: null,
      }),
    };
    expect(evaluateHostedSessionContract(same, "/work/repo")).toContain(
      "same: readAccess is declared, but a read launch is the write launch",
    );
  });

  it("report an adapter that declares hooks but writes no settings file", () => {
    const silent: HostedSessionAdapter = {
      provider: "silent",
      displayName: "Silent",
      capabilities: { ...capabilities, hooks: true },
      prepareLaunch: (intent) => ({
        program: "silent",
        arguments: ["--session-id", intent.sessionId],
        environment: {},
        workingDirectory: intent.workingDirectory,
        mode: intent.mode,
        initialInput: intent.start.kind === "new" ? intent.start.instruction : null,
        environmentRemove: [],
        settingsFile: null,
      }),
    };
    const violations = evaluateHostedSessionContract(silent, "/work/repo");
    expect(violations.some((violation) => violation.includes("writes no settings file"))).toBe(
      true,
    );
    expect(
      violations.some((violation) => violation.includes("does not pass the settings file")),
    ).toBe(true);
  });
});
