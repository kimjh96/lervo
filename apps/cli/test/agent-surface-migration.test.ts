import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent surface migration CLI", () => {
  it("surfaces provider rules as approved canonical moves without printing configuration bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-agent-surface-"));
    roots.push(root);
    await mkdir(resolve(root, ".claude/rules"), { recursive: true });
    await mkdir(resolve(root, ".agents/rules"), { recursive: true });
    await writeFile(resolve(root, "AGENTS.md"), "# Instructions\n");
    await writeFile(
      resolve(root, ".claude/rules/api.md"),
      ["---", "lervo:", "  document:", "    route: architecture", "---", "# API behavior", ""].join(
        "\n",
      ),
    );
    await writeFile(resolve(root, ".claude/rules/zebra.md"), "# Purple zebra quorum\n");
    await writeFile(
      resolve(root, ".claude/settings.json"),
      '{"fixture":"do-not-print-this-setting"}\n',
    );
    await writeFile(resolve(root, ".agents/rules/custom.md"), "# Custom convention\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };

    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge"], io), errors.join("")).toBe(0);
    const output = messages.join("");
    expect(output).toContain("Plan status: item approvals required");
    expect(output).toContain(
      ".claude/rules/api.md -> docs/instructions/architecture/api.md (instruction; explicit_metadata)",
    );
    expect(output).toContain("deferred [semantic_classification_pending] .claude/rules/zebra.md");
    expect(output).toContain("approval: kdocop_");
    expect(output).not.toContain("do-not-print-this-setting");
    expect(errors).toEqual([]);
  });
});
