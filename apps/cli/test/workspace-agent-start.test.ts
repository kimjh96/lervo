import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  hostedLaunchRecordsPath,
  recordHostedLaunch,
  type HostedLaunchRecord,
} from "../src/hosted-launch-records.js";
import {
  dropPendingStart,
  pendingStart,
  pendingStartsOf,
  recordPendingStart,
  AGENT_STARTS_PER_HOUR,
  PENDING_START_LIMIT,
} from "../src/room-starts.js";
import { startAgentConversation } from "../src/workspace-agent-start.js";

const agent = `agt_${"c".repeat(24)}`;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function state(): Promise<{ environment: NodeJS.ProcessEnv; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "lervo-agent-start-"));
  directories.push(directory);
  return {
    environment: { ...process.env, LERVO_USER_STATE_DIRECTORY: directory, LERVO_AGENT_ID: agent },
    directory,
  };
}

const options = { instruction: "Fix the retry budget.", repository: "prj_x", startedBy: agent };

describe("an agent starting a conversation", () => {
  it("starts only as the calling session's own agent", async () => {
    const { environment } = await state();
    await expect(
      startAgentConversation(options, { ...environment, LERVO_AGENT_ID: `agt_${"d".repeat(24)}` }),
    ).rejects.toMatchObject({ code: "agent_not_caller" });
    await expect(
      startAgentConversation(options, { ...environment, LERVO_AGENT_ID: undefined }),
    ).rejects.toMatchObject({ code: "agent_not_caller" });
  });

  it("starts at most twelve conversations an hour, a backstop against a runaway loop", async () => {
    expect(AGENT_STARTS_PER_HOUR).toBe(12);
    const { environment } = await state();
    const now = new Date("2026-11-27T12:00:00.000Z");
    for (let index = 0; index < AGENT_STARTS_PER_HOUR; index += 1)
      await recordHostedLaunch(hostedLaunchRecordsPath(environment), {
        schemaVersion: 1,
        workspaceId: `wsp_${index}`,
        sessionId: `s${index}`,
        provider: "claude",
        projectId: "prj_x",
        branch: "lervo/x",
        conversationMode: "native",
        argumentDigest: `sha256:${"0".repeat(64)}`,
        settingsDigest: null,
        mcpConfigDigest: null,
        preparedAt: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
        agentId: agent,
        startedBy: agent,
      } satisfies HostedLaunchRecord);
    await expect(startAgentConversation(options, environment, now)).rejects.toMatchObject({
      code: "conversation_start_limited",
    });
  });
});

describe("pending starts", () => {
  it("keeps each start until it opens, an hour at most, and the newest few", async () => {
    const { directory } = await state();
    const path = join(directory, "room-starts.json");
    const at = new Date("2026-11-27T12:00:00.000Z");
    const start = (index: number, preparedAt = at) => ({
      workspaceId: `wsp_${index}`,
      agentId: agent,
      title: `Work ${index}`,
      text: `Do ${index}.`,
      preparedAt: preparedAt.toISOString(),
    });
    await recordPendingStart(path, start(0), at);
    await recordPendingStart(path, start(1), at);
    expect(await pendingStartsOf(path, agent, at)).toHaveLength(2);
    expect(await pendingStart(path, "wsp_1", agent, at)).toMatchObject({ title: "Work 1" });
    await dropPendingStart(path, "wsp_1", agent, at);
    expect((await pendingStartsOf(path, agent, at)).map((item) => item.workspaceId)).toEqual([
      "wsp_0",
    ]);
    // An hour later the start is gone; past the limit the oldest are.
    expect(await pendingStartsOf(path, agent, new Date(at.getTime() + 60 * 60_000))).toEqual([]);
    for (let index = 2; index < PENDING_START_LIMIT + 4; index += 1)
      await recordPendingStart(path, start(index), at);
    const kept = await pendingStartsOf(path, agent, at);
    expect(kept).toHaveLength(PENDING_START_LIMIT);
    expect(kept[0]?.workspaceId).toBe("wsp_4");
  });

  it("belongs to the agent that made it, which may hand it to a teammate to lead", async () => {
    const { directory } = await state();
    const path = join(directory, "room-starts.json");
    const at = new Date("2026-11-27T12:00:00.000Z");
    const teammate = `agt_${"e".repeat(24)}`;
    await recordPendingStart(
      path,
      {
        workspaceId: "wsp_h",
        agentId: teammate,
        startedBy: agent,
        title: "Port the verifier",
        text: "Port it.",
        preparedAt: at.toISOString(),
      },
      at,
    );
    // The starter's turn delivers it; the lead's session opens from it.
    expect(await pendingStartsOf(path, agent, at)).toMatchObject([
      { workspaceId: "wsp_h", agentId: teammate, startedBy: agent },
    ]);
    expect(await pendingStartsOf(path, teammate, at)).toEqual([]);
    expect(await pendingStart(path, "wsp_h", teammate, at)).toMatchObject({ startedBy: agent });
  });
});
