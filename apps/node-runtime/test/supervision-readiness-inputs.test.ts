import { projectOutcomeSupervision } from "@lervo/work-controller";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readSupervisionReadinessInputs } from "../src/supervision-readiness-inputs.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps readiness inputs stable until Node configuration or repository knowledge changes", async () => {
  const f = await dispatchFixture(roots);
  const plan = (await f.ports.propose(
    projectOutcomeSupervision({
      snapshot: f.observation,
      now: f.ports.now(),
      maximumRecoveryDecisions: 1,
    }),
  ))!;
  const read = (
    configuration: Parameters<typeof readSupervisionReadinessInputs>[0]["configuration"],
  ) =>
    readSupervisionReadinessInputs({
      repositoryRoot: f.root,
      plan,
      configuration,
      now: f.ports.now,
    });
  const configuration = {
    providerExecutables: {},
    verificationTools: {},
    verificationSuiteHashes: {},
  };
  const first = await read(configuration);
  expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(await read(configuration)).toBe(first);
  expect(
    await read({
      ...configuration,
      verificationTools: {
        "role.organization.decision": [{ toolId: "lint", executable: "/bin/true" }],
      },
    }),
  ).not.toBe(first);
  await writeFile(resolve(f.root, "src/new.ts"), "export const changed = true;\n");
  expect(await read(configuration)).not.toBe(first);
}, 30_000);
