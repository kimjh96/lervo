import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import {
  authorizeCliFirstPublicationArming,
  writeFirstPublicationArmingAuthorization,
} from "../lib/cli-first-publication-arming.mjs";
import { readFirstPublicationArmingSources } from
  "../lib/first-publication-arming-sources.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function sources() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-arming-command-"));
  const source = createFirstPublicationFixture({
    approvalId: "apr_arm_cmd1",
    armingDecisionId: "arm_command1",
  });
  const options = {
    publicationAuthorizationPath: resolve(root, "publication.json"),
    bootstrapPath: resolve(root, "bootstrap.json"),
    decisionPath: resolve(root, "decision.json"),
  };
  await Promise.all([
    writeFile(
      options.publicationAuthorizationPath,
      `${JSON.stringify(source.publicationAuthorization, null, 2)}\n`,
    ),
    writeFile(options.bootstrapPath, `${JSON.stringify(source.bootstrap, null, 2)}\n`),
    writeFile(options.decisionPath, `${JSON.stringify(source.armingDecision, null, 2)}\n`),
  ]);
  return { root, source, options };
}

describe("first-publication arming command", () => {
  it("creates an authorization without changing any source", async () => {
    const prepared = await sources();
    try {
      const before = await readdir(prepared.root);
      const authorization = await authorizeCliFirstPublicationArming(prepared.options, {
        now: () => "2026-08-21T03:00:30Z",
      });
      assert.equal(authorization.status, "armed");
      assert.equal(authorization.binding.decisionId, prepared.source.armingDecision.decisionId);
      assert.deepEqual(await readdir(prepared.root), before);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("writes one new document and refuses replacement", async () => {
    const prepared = await sources();
    try {
      const authorization = await authorizeCliFirstPublicationArming(prepared.options, {
        now: () => "2026-08-21T03:00:30Z",
      });
      const outputPath = resolve(prepared.root, "arming.json");
      await writeFirstPublicationArmingAuthorization(outputPath, authorization);
      assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), authorization);
      await assert.rejects(
        writeFirstPublicationArmingAuthorization(outputPath, authorization),
        { code: "EEXIST" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects noncanonical decisions and a source changed during authorization", async () => {
    const malformed = await sources();
    try {
      await writeFile(
        malformed.options.decisionPath,
        JSON.stringify(malformed.source.armingDecision),
      );
      await assert.rejects(
        authorizeCliFirstPublicationArming(malformed.options, {
          now: () => "2026-08-21T03:00:30Z",
        }),
        { code: "first_publication_arming_source_invalid" },
      );
    } finally {
      await rm(malformed.root, { recursive: true, force: true });
    }

    const changed = await sources();
    try {
      await assert.rejects(authorizeCliFirstPublicationArming(changed.options, {
        now: () => "2026-08-21T03:00:30Z",
        readSources: async (options) => {
          const result = await readFirstPublicationArmingSources(options);
          await writeFile(options.decisionPath, `${JSON.stringify({ changed: true }, null, 2)}\n`);
          return result;
        },
      }), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(changed.root, { recursive: true, force: true });
    }
  });

  it("rejects relative, duplicate, online, and unknown arguments before source reads", () => {
    const cases = [
      [
        "--publication-authorization", "relative.json", "--bootstrap", "/bootstrap.json",
        "--decision", "/decision.json", "--output", "/arming.json",
      ],
      [
        "--publication-authorization", "/publication.json", "--bootstrap", "/bootstrap.json",
        "--decision", "/decision.json", "--decision", "/other.json",
        "--output", "/arming.json",
      ],
      [
        "--publication-authorization", "/publication.json", "--bootstrap", "/bootstrap.json",
        "--decision", "/decision.json", "--output", "/arming.json", "--online",
      ],
      ["--unknown"],
    ];
    for (const args of cases) {
      const result = spawnSync(process.execPath, [
        "scripts/authorize-cli-first-publication-arming.mjs",
        ...args,
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_arming_arguments_invalid:/u);
    }
  });
});
