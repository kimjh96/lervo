import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function io(cwd: string, stdout: string[] = [], stderr: string[] = [], stdin?: string) {
  return {
    cwd,
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function activateEventWriterV2(root: string): Promise<void> {
  const evidenceOutput: string[] = [];
  expect(
    await runCli(
      ["event-contract", "evidence", "--root", root, "--json"],
      io(root, evidenceOutput),
    ),
  ).toBe(0);
  const evidence = evidenceOutput.join("");
  const planOutput: string[] = [];
  expect(
    await runCli(
      ["event-contract", "activate", "--stdin", "--root", root, "--json"],
      io(root, planOutput, [], evidence),
    ),
  ).toBe(0);
  const plan = JSON.parse(planOutput.join("")) as { planId: string };
  expect(
    await runCli(
      ["event-contract", "activate", "--stdin", "--apply", plan.planId, "--root", root, "--json"],
      io(root, [], [], evidence),
    ),
  ).toBe(0);
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("root-agent liveness CLI", () => {
  it("records a privacy-bounded v2 heartbeat and projects it without changing authority", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-liveness-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "agent-liveness"], io(root))).toBe(0);
    await activateEventWriterV2(root);

    const hiredOutput: string[] = [];
    expect(
      await runCli(
        [
          "agent",
          "hire",
          "--role",
          "developer",
          "--provider",
          "codex",
          "--root",
          root,
          "--write",
          "--json",
        ],
        io(root, hiredOutput),
      ),
    ).toBe(0);
    const agent = JSON.parse(hiredOutput.join("")) as { agentId: string; revision: number };

    const beforeOutput: string[] = [];
    expect(
      await runCli(
        ["agent", "inspect", "--agent", agent.agentId, "--root", root, "--json"],
        io(root, beforeOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(beforeOutput.join("")).liveness).toMatchObject({
      status: "unobserved",
      releasesAgentAuthority: false,
      provesManagedProcessHealth: false,
    });

    const heartbeatOutput: string[] = [];
    expect(
      await runCli(
        [
          "agent",
          "heartbeat",
          "--agent",
          agent.agentId,
          "--revision",
          String(agent.revision),
          "--provider",
          "codex",
          "--session",
          "ses_private_runtime_01",
          "--root",
          root,
          "--write",
          "--json",
        ],
        io(root, heartbeatOutput),
      ),
    ).toBe(0);
    const heartbeat = JSON.parse(heartbeatOutput.join(""));
    expect(heartbeat).toMatchObject({
      status: "recorded",
      observation: {
        agentId: agent.agentId,
        agentRevision: agent.revision,
        reportingProvider: "codex",
        providerSessionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    });
    expect(JSON.stringify(heartbeat)).not.toContain("ses_private_runtime_01");

    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find((candidate) => candidate.type === "agent.liveness.observed");
      expect(event).toMatchObject({
        schemaVersion: 2,
        actor: { kind: "agent", provider: "codex" },
        payload: heartbeat.observation,
      });
      expect(JSON.stringify(event)).not.toContain("ses_private_runtime_01");
      const observedAt = new Date().toISOString();
      storage.events.append({
        eventId: "evt_process_observation_01",
        projectId: storage.manifest.projectId,
        runId: "run_process_observation_01",
        sessionId: "ses_process_observation_01",
        type: "provider.process.observed",
        occurredAt: observedAt,
        actor: { kind: "provider", provider: "claude" },
        schemaVersion: 2,
        policyVersion: `sha256:${"a".repeat(64)}`,
        payload: {
          adapterId: "claude-agent-sdk",
          providerSessionDigest: `sha256:${"b".repeat(64)}`,
          phase: "turn_terminal",
          status: "unobservable",
          evidence: "transport_state_unavailable",
          observedAt,
          releasesAgentAuthority: false,
          releasesAssignmentAuthority: false,
          provesWorkProgress: false,
        },
      });
    } finally {
      await storage.close();
    }

    const afterOutput: string[] = [];
    expect(
      await runCli(
        ["agent", "inspect", "--agent", agent.agentId, "--root", root, "--json"],
        io(root, afterOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(afterOutput.join("")).liveness).toMatchObject({
      status: "recently_observed",
      releasesAgentAuthority: false,
      provesManagedProcessHealth: false,
    });
  });

  it("rejects a stale root revision without appending a liveness event", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-liveness-stale-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "agent-liveness"], io(root))).toBe(0);
    const hiredOutput: string[] = [];
    expect(
      await runCli(
        ["agent", "hire", "--role", "developer", "--root", root, "--write", "--json"],
        io(root, hiredOutput),
      ),
    ).toBe(0);
    const agent = JSON.parse(hiredOutput.join("")) as { agentId: string };
    const stderr: string[] = [];
    expect(
      await runCli(
        [
          "agent",
          "heartbeat",
          "--agent",
          agent.agentId,
          "--revision",
          "2",
          "--provider",
          "codex",
          "--session",
          "ses_private_runtime_01",
          "--root",
          root,
          "--write",
        ],
        io(root, [], stderr),
      ),
    ).toBe(1);
    expect(stderr.join("")).toContain("exact active agent revision");
    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events.list().filter((event) => event.type === "agent.liveness.observed"),
      ).toHaveLength(0);
    } finally {
      await storage.close();
    }
  });
});
