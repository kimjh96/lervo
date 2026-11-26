import { describe, expect, it } from "vitest";

import type { HostedLaunch } from "@lervo/adapter-contract";

import { withSessionEnvironment } from "../src/hosted-session-environment.js";

const launch = { environment: { PATH: "/usr/bin" } } as unknown as HostedLaunch;

describe("a hosted session's environment", () => {
  it("names the agent and shares the core's Lervo state locations that are set", () => {
    const shared = withSessionEnvironment(launch, "agt_1", {
      LERVO_USER_STATE_DIRECTORY: "/state/dev",
      LERVO_WORKSPACES_HOME: "",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "secret",
    });
    expect(shared.environment).toEqual({
      PATH: "/usr/bin",
      LERVO_USER_STATE_DIRECTORY: "/state/dev",
      LERVO_AGENT_ID: "agt_1",
    });
  });

  it("adds nothing a default core leaves unset", () => {
    expect(withSessionEnvironment(launch, undefined, {}).environment).toEqual({ PATH: "/usr/bin" });
  });
});
