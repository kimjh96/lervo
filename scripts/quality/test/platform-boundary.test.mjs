import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, it } from "vitest";

import {
  comparePlatformBoundary,
  lowerPlatformBoundaryBaseline,
  observePlatformBoundary,
} from "../lib/platform-boundary.mjs";

async function fixtureTree(files) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-platform-boundary-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
  return root;
}

const baseFiles = {
  "apps/runtime/src/config.ts": "export const discordConversations = [];\nexport const port = 1;\n",
  "apps/runtime/src/conversation-router.ts":
    'import { reply } from "./discord-reply.js";\nexport const route = reply;\n',
  "apps/runtime/src/discord-reply.ts": "export const reply = 'Discord';\n",
  "apps/runtime/src/neutral.ts": "export const neutral = true;\n",
  "apps/runtime/test/config.test.ts": "const discord = 'test only';\n",
  "packages/adapter-discord/src/adapter.ts": "export const discord = 'adapter';\n",
  "apps/runtime/src/slack-adapter.ts": "export const slack = 'adapter';\n",
};

async function observedBaseline(root) {
  const observation = await observePlatformBoundary({ repositoryRoot: root });
  return {
    schemaVersion: 1,
    platforms: Object.fromEntries(
      Object.entries(observation).map(([platform, files]) => [platform, { files }]),
    ),
  };
}

describe("platform boundary ratchet", () => {
  it("excludes adapter packages, prefixed adapter files, and tests from the observation", async () => {
    const root = await fixtureTree(baseFiles);
    const observation = await observePlatformBoundary({ repositoryRoot: root });
    assert.deepEqual(observation, {
      discord: {
        "apps/runtime/src/config.ts": { lines: 1 },
        "apps/runtime/src/conversation-router.ts": {
          lines: 1,
          imports: ["./discord-reply.js"],
        },
      },
      slack: {},
    });
  });

  it("passes on the baseline and fails on an injected leak", async () => {
    const root = await fixtureTree(baseFiles);
    const baseline = await observedBaseline(root);
    assert.deepEqual(
      comparePlatformBoundary({
        baseline,
        observation: await observePlatformBoundary({ repositoryRoot: root }),
      }),
      [],
    );

    await writeFile(
      resolve(root, "apps/runtime/src/neutral.ts"),
      "export const neutral = 'Slack thread';\n",
    );
    await writeFile(
      resolve(root, "apps/runtime/src/config.ts"),
      "export const discordConversations = [];\nexport const discordToken = '';\n",
    );
    await writeFile(
      resolve(root, "apps/runtime/src/conversation-router.ts"),
      'import { reply } from "./discord-reply.js";\nimport { other } from "./discord-other.js";\nexport const route = [reply, other];\n',
    );
    const issues = comparePlatformBoundary({
      baseline,
      observation: await observePlatformBoundary({ repositoryRoot: root }),
    });
    assert.deepEqual(issues, [
      "apps/runtime/src/config.ts mentions discord on 2 line(s); the baseline allows 1.",
      "apps/runtime/src/conversation-router.ts mentions discord on 2 line(s); the baseline allows 1.",
      "apps/runtime/src/conversation-router.ts newly imports the discord adapter module ./discord-other.js.",
      "apps/runtime/src/neutral.ts mentions slack on 1 line(s) outside its adapter boundary and is absent from the baseline.",
    ]);
    assert.equal(
      lowerPlatformBoundaryBaseline({
        baseline,
        observation: await observePlatformBoundary({ repositoryRoot: root }),
      }).status,
      "refused",
    );
  });

  it("refreshes the baseline only downward", async () => {
    const root = await fixtureTree(baseFiles);
    const baseline = await observedBaseline(root);
    await writeFile(resolve(root, "apps/runtime/src/config.ts"), "export const ports = [];\n");
    const result = lowerPlatformBoundaryBaseline({
      baseline,
      observation: await observePlatformBoundary({ repositoryRoot: root }),
    });
    assert.equal(result.status, "lowered");
    assert.deepEqual(result.baseline.platforms.discord.files, {
      "apps/runtime/src/conversation-router.ts": { lines: 1, imports: ["./discord-reply.js"] },
    });

    await writeFile(
      resolve(root, "apps/runtime/src/config.ts"),
      "export const discordConversations = [];\n",
    );
    assert.deepEqual(
      comparePlatformBoundary({
        baseline: result.baseline,
        observation: await observePlatformBoundary({ repositoryRoot: root }),
      }),
      [
        "apps/runtime/src/config.ts mentions discord on 1 line(s) outside its adapter boundary and is absent from the baseline.",
      ],
    );
  });

  it("keeps the tracked repository baseline current", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const baseline = JSON.parse(
      await readFile(resolve(repositoryRoot, "scripts/quality/platform-boundary-baseline.json")),
    );
    assert.deepEqual(
      comparePlatformBoundary({
        baseline,
        observation: await observePlatformBoundary({ repositoryRoot }),
      }),
      [],
    );
  });
});
