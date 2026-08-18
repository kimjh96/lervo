import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "roven-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("roven init CLI", () => {
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
    expect(output).toContain("생성  .roven/project.yaml");
    expect(output).toContain("+ name: fixture");
    await expect(access(resolve(root, ".roven"))).rejects.toThrow();
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
    expect(messages.join("")).toContain("Roven 프로젝트를 초기화했습니다.");
    expect(messages.join("")).toContain("이미 초기화된 프로젝트입니다.");
  });
});

describe("roven run CLI arguments", () => {
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
    expect(errorOutput).toContain("provider, path와 작업 문장이 필요합니다");
  });
});
