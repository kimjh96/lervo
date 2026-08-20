import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";

import { runCli } from "../src/main.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo CLI identity", () => {
  it("reports the CLI package version without opening project storage", async () => {
    let output = "";
    let errors = "";
    let storageOpened = false;
    const exitCode = await runCli(
      ["--version"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => { output += message; },
        stderr: (message) => { errors += message; },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toMatch(/^lervo \d+\.\d+\.\d+\n$/);
    expect(errors).toBe("");
    expect(storageOpened).toBe(false);
  });

  it("rejects extra version arguments", async () => {
    let errors = "";
    expect(await runCli(["--version", "extra"], {
      cwd: process.cwd(),
      stdout: () => undefined,
      stderr: (message) => { errors += message; },
    })).toBe(1);
    expect(errors).toContain("다른 인자를 함께 사용할 수 없습니다");
  });
});

describe("lervo init CLI", () => {
  it("prints the exact creation plan without mutating on dry-run", async () => {
    const root = await temporaryRepository();
    let output = "";
    const exitCode = await runCli(["init", "--dry-run", "--name", "fixture"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("생성  .lervo/project.yaml");
    expect(output).toContain("+ name: fixture");
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });

  it("applies init and reports an idempotent second run", async () => {
    const root = await temporaryRepository();
    const messages: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => messages.push(message),
    };

    expect(await runCli(["init"], io)).toBe(0);
    expect(await runCli(["init"], io)).toBe(0);
    expect(messages.join("")).toContain("Lervo 프로젝트를 초기화했습니다.");
    expect(messages.join("")).toContain("이미 초기화된 프로젝트입니다.");
  });
});

describe("lervo run CLI arguments", () => {
  it("rejects an incomplete run command before opening a managed run", async () => {
    const root = await temporaryRepository();
    let called = false;
    let errorOutput = "";
    const exitCode = await runCli(
      ["run", "--provider", "codex", "작업"],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => { errorOutput += message; },
      },
      {
        executeManagedRun: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errorOutput).toContain("provider, path, verification suite와 작업 문장이 필요합니다");
  });
});

describe("lervo trace CLI", () => {
  it("reports machine-readable capabilities without opening project storage", async () => {
    let output = "";
    let errors = "";
    let storageOpened = false;
    const exitCode = await runCli(
      ["trace", "--capabilities"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => { output += message; },
        stderr: (message) => { errors += message; },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(storageOpened).toBe(false);
    expect(errors).toBe("");
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      capability: "trace",
      defaultMode: "page",
      limits: {
        defaultPageSize: 50,
        maximumPageSize: 100,
        maximumFullEventCount: 1000,
        maximumCursorBytes: 2048,
      },
      deprecations: [],
    });

    let explicitJsonOutput = "";
    expect(await runCli(
      ["trace", "--capabilities", "--json"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => { explicitJsonOutput += message; },
        stderr: (message) => { errors += message; },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    )).toBe(0);
    expect(JSON.parse(explicitJsonOutput)).toEqual(JSON.parse(output));
    expect(storageOpened).toBe(false);
    expect(errors).toBe("");
  });

  it("traces the latest run from append-only local events", async () => {
    const root = await temporaryRepository();
    expect(await runCli(["init"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    })).toBe(0);
    const storage = await openProjectStorage(root);
    const common = {
      projectId: storage.manifest.projectId,
      runId: "run_cli_trace_0001",
      sessionId: "ses_cli_trace_0001",
      actor: { kind: "system" as const },
      schemaVersion: 1 as const,
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_start",
      type: "run.requested",
      occurredAt: "2026-08-19T00:00:00Z",
      payload: {
        requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        role: "developer",
        risk: "low",
      },
    });
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_done",
      type: "run.completed",
      occurredAt: "2026-08-19T00:00:01Z",
      payload: {
        resultDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        artifactIds: ["art_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
        verificationStatus: "not_run",
      },
    });
    await storage.close();

    let output = "";
    let defaultErrors = "";
    const code = await runCli(["trace", "last"], {
      cwd: root,
      stdout: (message) => { output += message; },
      stderr: (message) => { defaultErrors += message; },
    });

    expect(code).toBe(0);
    expect(output).toContain("실행 추적 페이지: run_cli_trace_0001");
    expect(output).toContain("run.requested");
    expect(output).toContain("run.completed");
    expect(output).not.toContain("원문 주장");
    expect(defaultErrors).toBe("");

    let jsonOutput = "";
    let jsonErrors = "";
    expect(await runCli(["trace", "last", "--json"], {
      cwd: root,
      stdout: (message) => { jsonOutput += message; },
      stderr: (message) => { jsonErrors += message; },
    })).toBe(0);
    expect(JSON.parse(jsonOutput)).toMatchObject({
      schemaVersion: 1,
      runId: "run_cli_trace_0001",
      page: { returnedCount: 2, hasMore: false },
    });
    expect(JSON.parse(jsonOutput)).not.toHaveProperty("status");
    expect(jsonErrors).toBe("");

    let explicitFullOutput = "";
    let explicitFullErrors = "";
    expect(await runCli(["trace", "last", "--full", "--json"], {
      cwd: root,
      stdout: (message) => { explicitFullOutput += message; },
      stderr: (message) => { explicitFullErrors += message; },
    })).toBe(0);
    expect(JSON.parse(explicitFullOutput)).toMatchObject({
      schemaVersion: 1,
      runId: "run_cli_trace_0001",
      status: "completed",
    });
    expect(JSON.parse(explicitFullOutput).events).toEqual(JSON.parse(jsonOutput).events);
    expect(explicitFullErrors).toBe("");

    let firstPageOutput = "";
    let firstPageErrors = "";
    expect(await runCli(["trace", "last", "--page-size", "1", "--json"], {
      cwd: root,
      stdout: (message) => { firstPageOutput += message; },
      stderr: (message) => { firstPageErrors += message; },
    })).toBe(0);
    const firstPage = JSON.parse(firstPageOutput);
    expect(firstPage.events.map((event: { seq: number }) => event.seq)).toEqual([1]);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPageErrors).toBe("");

    let secondPageOutput = "";
    expect(await runCli(["trace", "--cursor", firstPage.page.nextCursor, "--json"], {
      cwd: root,
      stdout: (message) => { secondPageOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    const secondPage = JSON.parse(secondPageOutput);
    expect(secondPage.events.map((event: { seq: number }) => event.seq)).toEqual([2]);
    expect(secondPage.page.hasMore).toBe(false);

    let filteredOutput = "";
    expect(await runCli(["trace", "last", "--event-type", "run.completed", "--json"], {
      cwd: root,
      stdout: (message) => { filteredOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    const filtered = JSON.parse(filteredOutput);
    expect(filtered.filter).toEqual({ eventTypes: ["run.completed"] });
    expect(filtered.events.map((event: { seq: number }) => event.seq)).toEqual([2]);
  });

});
