import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const logic = vi.hoisted(() => ({ contract: "adr-0532:aaaa" }));
vi.mock("../src/evaluation-contract.js", async (original) => ({
  ...(await original<typeof import("../src/evaluation-contract.js")>()),
  convergenceEvaluationContract: () => logic.contract,
}));

const { observationKey } = await import("../src/freshness-cycle-observation.js");

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("reopens the freshness fence when the runtime's evaluation logic changes (ADR-0631)", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-fence-"));
  directories.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@lervo.invalid",
      ...args,
    ]);
  git("init", "-q");
  await writeFile(join(root, "README.md"), "# Repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const input = { day: "2026-11-24" };
  const before = await observationKey(root, input);
  expect(before).not.toBeNull();
  // The same repository, inputs, and logic keep the fence closed.
  expect(await observationKey(root, input)).toBe(before);
  // A deploy of new logic opens it once, with no repository change.
  logic.contract = "adr-0532:bbbb";
  expect(await observationKey(root, input)).not.toBe(before);
});
