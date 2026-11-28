import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_LAUNCH_RECORD_LIMIT,
  type HostedLaunchRecord,
  latestHostedLaunch,
  recordHostedLaunch,
  roomSessionRecords,
  memberWorkspacesOf,
  conversationsLedBy,
} from "../src/hosted-launch-records.js";
import { resolveHostedSessionAdapter } from "../src/hosted-session-adapters.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function record(index: number, workspaceId = `wsp_${String(index).padStart(24, "0")}`) {
  return {
    schemaVersion: 1,
    workspaceId,
    sessionId: `session-${index}`,
    provider: "claude",
    projectId: "prj_0123456789abcdef",
    branch: `lervo/work-${index}`,
    conversationMode: "native",
    argumentDigest: `sha256:${"a".repeat(64)}`,
    settingsDigest: null,
    mcpConfigDigest: null,
    preparedAt: new Date(index * 1000).toISOString(),
  } satisfies HostedLaunchRecord;
}

describe("hosted launch records", () => {
  it("keeps the newest records in an owner-only file and finds a workspace's latest", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-hosted-launches-"));
    roots.push(root);
    const path = resolve(root, "state", "hosted-launches.json");
    for (let index = 0; index < HOSTED_LAUNCH_RECORD_LIMIT + 2; index += 1)
      await recordHostedLaunch(path, record(index));
    await recordHostedLaunch(path, record(999, "wsp_000000000000000000000005"));
    expect(await latestHostedLaunch(path, "wsp_000000000000000000000000")).toBeNull();
    expect((await latestHostedLaunch(path, "wsp_000000000000000000000005"))?.sessionId).toBe(
      "session-999",
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe("a conversation's agents in the launch records", () => {
  it("leads with the writing session and lists each agent's newest session in joining order", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-hosted-rooms-"));
    roots.push(root);
    const path = resolve(root, "hosted-launches.json");
    const workspaceId = `wsp_${"1".repeat(24)}`;
    const lead = { ...record(1, workspaceId), agentId: "agt_elio", participants: ["agt_elio"] };
    await recordHostedLaunch(path, lead);
    await recordHostedLaunch(path, {
      ...record(2, workspaceId),
      agentId: "agt_arin",
      access: "read",
    });
    await recordHostedLaunch(path, {
      ...record(3, workspaceId),
      agentId: "agt_tarin",
      access: "read",
    });
    await recordHostedLaunch(path, {
      ...record(4, workspaceId),
      sessionId: "session-arin-resumed",
      agentId: "agt_arin",
      access: "read",
    });
    // A joined agent's newer record never becomes the conversation's lead.
    expect((await latestHostedLaunch(path, workspaceId))?.sessionId).toBe("session-1");
    expect(
      (await roomSessionRecords(path, workspaceId)).map((item) => [item.agentId, item.sessionId]),
    ).toEqual([
      ["agt_elio", "session-1"],
      ["agt_arin", "session-arin-resumed"],
      ["agt_tarin", "session-3"],
    ]);
  });

  it("counts a member's own workspace in its conversation, never as one it leads (ADR-0661)", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-hosted-members-"));
    roots.push(root);
    const path = resolve(root, "hosted-launches.json");
    const workspaceId = `wsp_${"2".repeat(24)}`;
    const memberWorkspace = `wsp_${"3".repeat(24)}`;
    await recordHostedLaunch(path, { ...record(1, workspaceId), agentId: "agt_bora" });
    await recordHostedLaunch(path, {
      ...record(2, memberWorkspace),
      branch: "lervo/machining-fix-abc123",
      agentId: "agt_machining",
      room: workspaceId,
    });
    expect(
      (await roomSessionRecords(path, workspaceId)).map((item) => [item.agentId, item.workspaceId]),
    ).toEqual([
      ["agt_bora", workspaceId],
      ["agt_machining", memberWorkspace],
    ]);
    expect(await memberWorkspacesOf(path, workspaceId)).toEqual([memberWorkspace]);
    expect(await conversationsLedBy(path, "agt_machining")).toEqual([]);
    expect(await conversationsLedBy(path, "agt_bora")).toEqual([workspaceId]);
    // The member's own workspace still finds its record, as retiring and sealing need.
    expect((await latestHostedLaunch(path, memberWorkspace))?.room).toBe(workspaceId);
  });
});

describe("hosted-session adapters", () => {
  it("names the admitted providers when one is unknown", async () => {
    await expect(resolveHostedSessionAdapter("gemini", { PATH: "" })).rejects.toMatchObject({
      code: "provider_unknown",
      details: { providers: ["claude", "codex"] },
    });
  });
});
