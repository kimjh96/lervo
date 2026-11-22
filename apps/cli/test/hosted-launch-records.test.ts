import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_LAUNCH_RECORD_LIMIT,
  type HostedLaunchRecord,
  latestHostedLaunch,
  recordHostedLaunch,
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

describe("hosted-session adapters", () => {
  it("names the admitted providers when one is unknown", async () => {
    await expect(resolveHostedSessionAdapter("gemini", { PATH: "" })).rejects.toMatchObject({
      code: "provider_unknown",
      details: { providers: ["claude", "codex"] },
    });
  });
});
