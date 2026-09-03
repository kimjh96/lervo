import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { prepareNpmInteractiveStageApproval } from "../first-publication/adapters/npm-interactive-stage-approval.mjs";
import { createFirstPublicationStageApprovalFixture } from "../first-publication/test/fixtures/first-publication-stage-approval.mjs";
import { stagedPackageId } from "../first-publication/test/fixtures/first-publication-stage-review.mjs";

function npmStage(report, overrides = {}) {
  return {
    id: stagedPackageId,
    packageName: report.target.package,
    version: report.target.version,
    tag: report.npm.stage.distTag,
    createdAt: report.npm.stage.createdAt,
    actor: { name: "private-user" },
    actorType: "user",
    shasum: report.npm.stage.shasum,
    ...overrides,
  };
}

describe("interactive npm stage approval adapter", () => {
  it("keeps the raw stage ID inside the adapter and calls only exact approve", async () => {
    const fixture = await createFirstPublicationStageApprovalFixture();
    const calls = [];
    let interactiveArgs;
    try {
      const prepared = await prepareNpmInteractiveStageApproval(
        {
          registry: fixture.stageReviewReport.npm.registry,
          packageName: fixture.stageReviewReport.target.package,
          version: fixture.stageReviewReport.target.version,
          expectedStage: fixture.stageReviewReport.npm.stage,
          userConfigPath: fixture.npmUserConfigPath,
        },
        {
          environment: { PATH: process.env.PATH, npm_config_loglevel: "verbose" },
          stdinIsTTY: true,
          stdoutIsTTY: true,
          stderrIsTTY: true,
          execute: async (_command, args, options) => {
            calls.push(args);
            assert.equal(options.env.npm_config_loglevel, "silent");
            if (args[0] === "--version") return { stdout: "11.18.0\n" };
            if (args[1] === "list") {
              return { stdout: JSON.stringify([npmStage(fixture.stageReviewReport)]) };
            }
            if (args[1] === "view") {
              return { stdout: JSON.stringify(npmStage(fixture.stageReviewReport)) };
            }
            throw new Error("unexpected command");
          },
          runInteractive: async (_command, args, _options, redactedId) => {
            interactiveArgs = args;
            assert.equal(redactedId, stagedPackageId);
          },
        },
      );
      await prepared.recheck();
      await prepared.approve();
      await prepared.dispose();
      assert.deepEqual(interactiveArgs, [
        "stage",
        "approve",
        stagedPackageId,
        "--registry",
        "https://registry.npmjs.org/",
      ]);
      assert.deepEqual(
        calls.map((args) => args.slice(0, 2)),
        [["--version"], ["stage", "list"], ["stage", "view"], ["stage", "view"]],
      );
      assert.equal(calls.flat().includes("reject"), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("blocks noninteractive automation, changed stage metadata, and user-config races", async () => {
    const fixture = await createFirstPublicationStageApprovalFixture();
    try {
      await assert.rejects(
        prepareNpmInteractiveStageApproval(
          {
            registry: fixture.stageReviewReport.npm.registry,
            packageName: fixture.stageReviewReport.target.package,
            version: fixture.stageReviewReport.target.version,
            expectedStage: fixture.stageReviewReport.npm.stage,
            userConfigPath: fixture.npmUserConfigPath,
          },
          {
            environment: { CI: "true" },
            stdinIsTTY: true,
            stdoutIsTTY: true,
            stderrIsTTY: true,
          },
        ),
        { code: "first_publication_stage_approval_environment_blocked" },
      );

      let viewCount = 0;
      const prepared = await prepareNpmInteractiveStageApproval(
        {
          registry: fixture.stageReviewReport.npm.registry,
          packageName: fixture.stageReviewReport.target.package,
          version: fixture.stageReviewReport.target.version,
          expectedStage: fixture.stageReviewReport.npm.stage,
          userConfigPath: fixture.npmUserConfigPath,
        },
        {
          environment: { PATH: process.env.PATH },
          stdinIsTTY: true,
          stdoutIsTTY: true,
          stderrIsTTY: true,
          execute: async (_command, args) => {
            if (args[0] === "--version") return { stdout: "11.18.0\n" };
            if (args[1] === "list") {
              return { stdout: JSON.stringify([npmStage(fixture.stageReviewReport)]) };
            }
            viewCount += 1;
            return {
              stdout: JSON.stringify(
                npmStage(
                  fixture.stageReviewReport,
                  viewCount === 1 ? {} : { createdAt: "2026-08-21T10:12:00Z" },
                ),
              ),
            };
          },
          runInteractive: async () => {},
        },
      );
      await assert.rejects(prepared.recheck(), {
        code: "first_publication_stage_approval_stage_mismatch",
      });
      await prepared.dispose();

      const stable = await prepareNpmInteractiveStageApproval(
        {
          registry: fixture.stageReviewReport.npm.registry,
          packageName: fixture.stageReviewReport.target.package,
          version: fixture.stageReviewReport.target.version,
          expectedStage: fixture.stageReviewReport.npm.stage,
          userConfigPath: fixture.npmUserConfigPath,
        },
        {
          environment: { PATH: process.env.PATH },
          stdinIsTTY: true,
          stdoutIsTTY: true,
          stderrIsTTY: true,
          execute: async (_command, args) =>
            args[0] === "--version"
              ? { stdout: "11.18.0\n" }
              : {
                  stdout: JSON.stringify(
                    args[1] === "list"
                      ? [npmStage(fixture.stageReviewReport)]
                      : npmStage(fixture.stageReviewReport),
                  ),
                },
          runInteractive: async () => {},
        },
      );
      await writeFile(fixture.npmUserConfigPath, "changed=true\n");
      await assert.rejects(stable.recheck(), {
        code: "release_attestation_release_set_changed",
      });
      await stable.dispose();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
