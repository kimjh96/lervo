import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveAutomaticVerificationSuite } from "../src/automatic-verification-suite.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repositoryWithSuites(...suiteIds: string[]): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-automatic-verification-"));
  roots.push(root);
  const directory = resolve(root, ".lervo/verifications");
  await mkdir(directory, { recursive: true });
  await Promise.all(
    suiteIds.map((suiteId) => writeFile(resolve(directory, `${suiteId}.yaml`), "fixture\n")),
  );
  return root;
}

describe("automatic verification suite resolution", () => {
  it("selects the highest versioned repository default", async () => {
    const root = await repositoryWithSuites(
      "repository.default",
      "repository.default.v2",
      "repository.default.v10",
      "project.other",
    );

    await expect(resolveAutomaticVerificationSuite(root)).resolves.toBe("repository.default.v10");
  });

  it("falls back to the unversioned repository default", async () => {
    const root = await repositoryWithSuites("repository.default", "project.other");

    await expect(resolveAutomaticVerificationSuite(root)).resolves.toBe("repository.default");
  });

  it("falls back to one non-pilot suite", async () => {
    const root = await repositoryWithSuites("project.only", "lervo.pilot.fixture");

    await expect(resolveAutomaticVerificationSuite(root)).resolves.toBe("project.only");
  });

  it("rejects an ambiguous non-default selection", async () => {
    const root = await repositoryWithSuites("project.one", "project.two");

    await expect(resolveAutomaticVerificationSuite(root)).rejects.toMatchObject({
      code: "deliberation_verification_ambiguous",
    });
  });

  it("rejects a repository without verification configuration", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-automatic-verification-missing-"));
    roots.push(root);

    await expect(resolveAutomaticVerificationSuite(root)).rejects.toMatchObject({
      code: "deliberation_verification_unconfigured",
    });
  });
});
