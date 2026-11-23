import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import { inspectReleaseCompletion } from "../lib/release-completion-check.mjs";
import {
  createReleaseIntent,
  loadReleaseIntents,
  ReleaseIntentError,
} from "../lib/release-intent.mjs";

const execFile = promisify(execFileCallback);
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root, ...args) {
  return (await execFile("git", args, { cwd: root })).stdout.trim();
}

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-release-targets-"));
  roots.push(root);
  for (const directory of ["apps/cli/src", "apps/ade/src", "packages", ".changes"])
    await mkdir(resolve(root, directory), { recursive: true });
  await writeFile(
    resolve(root, "apps/cli/package.json"),
    `${JSON.stringify({ name: "@lervo/cli", version: "0.2.2", private: false })}\n`,
  );
  await writeFile(
    resolve(root, "apps/cli/release-artifact-manifest.json"),
    `${JSON.stringify({ artifact: { version: "0.2.2" }, bundle: { workspacePackages: [] } })}\n`,
  );
  await writeFile(
    resolve(root, "apps/cli/release-sbom.cdx.json"),
    `${JSON.stringify({ metadata: { component: { version: "0.2.2" } } })}\n`,
  );
  await writeFile(
    resolve(root, ".changes/current-release.md"),
    '<!-- lervo-release package="@lervo/cli" version="0.2.2" schema="1" -->\n\n## What\'s changed\n\n- Previous release.\n',
  );
  await writeFile(resolve(root, "apps/cli/src/main.ts"), "export const value = 1;\n");
  await writeFile(resolve(root, "apps/ade/src/main.tsx"), "export const value = 1;\n");
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Lervo Test");
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize release target fixture");
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

const summary = "Show the Lervo mark while the window opens.";

describe("release intents for each version line (ADR-0615)", () => {
  it("writes an ADE intent to .changes/ade/ with its own package and ID", async () => {
    const { root } = await repository();
    const ade = await createReleaseIntent(root, { impact: "minor", summary, target: "ade" });
    const cli = await createReleaseIntent(root, { impact: "minor", summary });
    expect(ade.path).toBe(`.changes/ade/${ade.intent.intentId}.yaml`);
    expect(ade.intent.package).toBe("@lervo/ade");
    expect(cli.path).toBe(`.changes/${cli.intent.intentId}.yaml`);
    expect(ade.intent.intentId).not.toBe(cli.intent.intentId);
    const written = parse(await readFile(resolve(root, ade.path), "utf8"));
    expect(Object.keys(written).toSorted()).toEqual([
      "impact",
      "intentId",
      "package",
      "schemaVersion",
      "summary",
    ]);
  });

  it("keeps each line's intents apart when loading", async () => {
    const { root } = await repository();
    const ade = await createReleaseIntent(root, { impact: "patch", summary, target: "ade" });
    expect(await loadReleaseIntents(root)).toEqual([]);
    expect((await loadReleaseIntents(root, "ade")).map((intent) => intent.intentId)).toEqual([
      ade.intent.intentId,
    ]);
  });

  it("rejects an intent in the other line's directory and an unknown target", async () => {
    const { root } = await repository();
    const ade = await createReleaseIntent(root, { impact: "patch", summary, target: "ade" });
    await writeFile(
      resolve(root, ".changes", `${ade.intent.intentId}.yaml`),
      stringify(ade.intent, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" }),
    );
    await expect(loadReleaseIntents(root)).rejects.toMatchObject({
      code: "release_intent_invalid",
    });
    await expect(
      createReleaseIntent(root, { impact: "patch", summary, target: "web" }),
    ).rejects.toBeInstanceOf(ReleaseIntentError);
  });

  it("leaves the CLI release check untouched by an ADE change and its intent", async () => {
    const { root, base } = await repository();
    await writeFile(resolve(root, "apps/ade/src/main.tsx"), "export const value = 2;\n");
    await createReleaseIntent(root, { impact: "minor", summary, target: "ade" });
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat(ade): show the Lervo mark");
    await expect(
      inspectReleaseCompletion({ repositoryRoot: root, baseRevision: base }),
    ).resolves.toMatchObject({ valid: true, disposition: "not_required" });
  });
});
