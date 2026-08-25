import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";

import { runCli } from "../src/main.js";

export interface TraceFixtureInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TraceDefaultTransitionFixture {
  eventCount: number;
  runId: string;
  trace(args: string[]): Promise<TraceFixtureInvocation>;
  dispose(): Promise<void>;
}

const fixtureEventCount = 51;
const fixtureRunId = "run_trace_transition_01";

export async function createTraceDefaultTransitionFixture(): Promise<TraceDefaultTransitionFixture> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-trace-transition-"));
  const silentIo = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  if ((await runCli(["init"], silentIo)) !== 0) {
    await rm(root, { recursive: true, force: true });
    throw new Error("The trace transition fixture could not be initialized.");
  }

  try {
    const storage = await openProjectStorage(root);
    try {
      const common = {
        projectId: storage.manifest.projectId,
        runId: fixtureRunId,
        sessionId: "ses_trace_transition_01",
        actor: { kind: "system" as const },
        schemaVersion: 1 as const,
        policyVersion: `sha256:${"a".repeat(64)}`,
      };
      for (let index = 1; index <= fixtureEventCount; index += 1) {
        const terminal = index === fixtureEventCount;
        storage.events.append({
          ...common,
          eventId: `evt_trace_transition_${String(index).padStart(4, "0")}`,
          type: terminal ? "run.completed" : "run.requested",
          occurredAt: terminal ? "2026-08-20T00:00:02Z" : "2026-08-20T00:00:01Z",
          payload: terminal
            ? {
                resultDigest: `sha256:${"c".repeat(64)}`,
                artifactIds: [`art_${"c".repeat(64)}`],
                verificationStatus: "not_run",
              }
            : {
                requestDigest: `sha256:${"b".repeat(64)}`,
                role: "developer",
                risk: "low",
              },
        });
      }
    } finally {
      await storage.close();
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    eventCount: fixtureEventCount,
    runId: fixtureRunId,
    async trace(args) {
      let stdout = "";
      let stderr = "";
      const exitCode = await runCli(["trace", ...args], {
        cwd: root,
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        },
      });
      return { exitCode, stdout, stderr };
    },
    async dispose() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
