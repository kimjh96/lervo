import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

function io(cwd: string, stdout: string[] = [], stderr: string[] = []) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

describe("public README command", () => {
  it("requires the exact operation and every protected-coordinate disposition", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-readme-cli-"));
    await mkdir(resolve(root, "src"));
    expect(await runCli(["init", "--root", root, "--name", "readme-fixture"], io(root))).toBe(0);
    await writeFile(resolve(root, "README.md"), "# Product\n\n[License](LICENSE)\n");
    const candidate = resolve(root, "candidate.md");
    await writeFile(candidate, "# Product\n\nA clearer introduction.\n\n[License](LICENSE)\n");
    const proposed: string[] = [];
    expect(
      await runCli(
        [
          "readme",
          "propose",
          "--candidate",
          candidate,
          "--audience",
          "Package users",
          "--intent",
          "Clarify the introduction",
          "--json",
        ],
        io(root, proposed),
      ),
    ).toBe(0);
    const plan = JSON.parse(proposed.join(""));
    const applied: string[] = [];
    expect(
      await runCli(
        [
          "readme",
          "propose",
          "--candidate",
          candidate,
          "--audience",
          "Package users",
          "--intent",
          "Clarify the introduction",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          ...plan.coordinateChanges.flatMap((item: { changeId: string }) => [
            "--approve-coordinate",
            item.changeId,
          ]),
          "--json",
        ],
        io(root, applied),
      ),
    ).toBe(0);
    expect(JSON.parse(applied.join(""))).toMatchObject({
      operation: "public_readme_improvement",
      outputHash: plan.candidateHash,
    });
    expect(await readFile(resolve(root, "README.md"), "utf8")).toContain("A clearer introduction.");
  });
});
