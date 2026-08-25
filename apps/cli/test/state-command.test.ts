import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

it("resets only rebuildable state and preserves durable CAS data", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-state-reset-"));
  roots.push(root);
  const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init", "--minimal"], quiet)).toBe(0);
  const storage = await openProjectStorage(root);
  const artifact = await storage.artifacts.put("durable state boundary");
  await storage.close();
  await mkdir(resolve(root, ".lervo/state/example"), { recursive: true });
  await writeFile(resolve(root, ".lervo/state/example/projection.json"), '{"derived":true}\n');

  const output: string[] = [];
  expect(
    await runCli(["state", "status", "--json"], {
      ...quiet,
      stdout: (message) => output.push(message),
    }),
  ).toBe(0);
  const status = JSON.parse(output.splice(0).join("")) as {
    inspectionKind: string;
    stateDisposition: string;
    planId?: string;
    resetPlanDisposition: string;
  };
  expect(status).toMatchObject({
    inspectionKind: "derived_state_status",
    stateDisposition: "present",
    resetPlanDisposition: "run_state_reset_to_create_content_bound_plan",
  });
  expect(status.planId).toBeUndefined();

  expect(
    await runCli(["state", "reset", "--json"], {
      ...quiet,
      stdout: (message) => output.push(message),
    }),
  ).toBe(0);
  const plan = JSON.parse(output.join("")) as { planId: string; durableDataDisposition: string };
  expect(plan.durableDataDisposition).toBe("preserved");
  expect(await runCli(["state", "reset", "--apply", "--approval", plan.planId], quiet)).toBe(0);
  await expect(
    readFile(resolve(root, ".lervo/state/example/projection.json"), "utf8"),
  ).rejects.toThrow();

  const reopened = await openProjectStorage(root);
  expect(Buffer.from(await reopened.artifacts.get(artifact.uri)).toString("utf8")).toBe(
    "durable state boundary",
  );
  await reopened.close();
});
