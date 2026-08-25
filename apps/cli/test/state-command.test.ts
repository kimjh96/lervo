import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

it("plans and applies selective pruning with path-private durable evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-state-prune-"));
  roots.push(root);
  const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init", "--minimal"], quiet)).toBe(0);
  const cache = resolve(root, ".lervo/state/knowledge/normalization-shards/old.json");
  const current = resolve(root, ".lervo/state/knowledge/current/inventory.json");
  await mkdir(resolve(cache, ".."), { recursive: true });
  await mkdir(resolve(current, ".."), { recursive: true });
  await writeFile(cache, '{"cache":true}\n');
  await writeFile(current, '{"current":true}\n');
  await utimes(cache, new Date(0), new Date(0));

  const output: string[] = [];
  expect(
    await runCli(["state", "prune", "--json"], {
      ...quiet,
      stdout: (message) => output.push(message),
    }),
  ).toBe(0);
  const planSource = output.splice(0).join("");
  const plan = JSON.parse(planSource) as { planId: string; operations: unknown[] };
  expect(plan.operations).toHaveLength(1);
  expect(planSource).not.toContain("normalization-shards");

  expect(await runCli(["state", "prune", "--apply", "--approval", plan.planId], quiet)).toBe(0);
  await expect(readFile(cache, "utf8")).rejects.toThrow();
  expect(await readFile(current, "utf8")).toContain("current");

  const storage = await openProjectStorage(root);
  const event = storage.events.list({ limit: 100 }).find((item) => item.type === "state.pruned");
  expect(event?.payload).toMatchObject({ planId: plan.planId, removedFiles: 1 });
  expect(JSON.stringify(event?.payload)).not.toContain("normalization-shards");
  await storage.close();
});
