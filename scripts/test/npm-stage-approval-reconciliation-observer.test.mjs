import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { observeNpmStageApprovalReconciliation } from "../lib/npm-stage-approval-reconciliation-observer.mjs";
import {
  createFirstPublicationStageApprovalReconciliationFixture,
  matchingPublicReleaseObservation,
} from "./fixtures/first-publication-stage-approval-reconciliation.mjs";
import { stagedPackageId } from "./fixtures/first-publication-stage-review.mjs";

function input(fixture) {
  return {
    registry: fixture.authorization.binding.registry,
    packageName: fixture.stageReviewReport.target.package,
    version: fixture.stageReviewReport.target.version,
    distTag: fixture.authorization.binding.distTag,
    expectedStageIdDigest: fixture.authorization.binding.stageIdDigest,
    userConfigPath: fixture.npmUserConfigPath,
  };
}

function stage(fixture) {
  return {
    id: stagedPackageId,
    packageName: fixture.stageReviewReport.target.package,
    version: fixture.stageReviewReport.target.version,
    tag: fixture.authorization.binding.distTag,
    createdAt: fixture.stageReviewReport.npm.stage.createdAt,
    actor: { name: "private-user" },
    actorType: "user",
    shasum: fixture.authorization.binding.artifact.registryShasum,
  };
}

describe("npm stage approval reconciliation observer", () => {
  it("observes public release between two stable authenticated stage lists", async () => {
    const fixture = await createFirstPublicationStageApprovalReconciliationFixture();
    const calls = [];
    try {
      const result = await observeNpmStageApprovalReconciliation(input(fixture), {
        environment: { PATH: process.env.PATH },
        execute: async (_command, args) => {
          calls.push(args);
          return args[0] === "--version" ? { stdout: "11.18.0\n" } : { stdout: "[]\n" };
        },
        observePublicRelease: async () => matchingPublicReleaseObservation(fixture),
      });
      assert.equal(result.state, "observed");
      assert.equal(result.stage.state, "absent");
      assert.equal(JSON.stringify(result).includes(stagedPackageId), false);
      assert.deepEqual(
        calls.map((args) => args.slice(0, 2)),
        [["--version"], ["stage", "list"], ["stage", "list"]],
      );
      assert.equal(
        calls.flat().some((value) => ["approve", "reject"].includes(value)),
        false,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports a present exact stage and fails closed on list or config races", async () => {
    for (const scenario of ["present", "list-race", "config-race"]) {
      const fixture = await createFirstPublicationStageApprovalReconciliationFixture();
      let listCount = 0;
      try {
        const result = await observeNpmStageApprovalReconciliation(input(fixture), {
          environment: { PATH: process.env.PATH },
          execute: async (_command, args) => {
            if (args[0] === "--version") return { stdout: "11.18.0\n" };
            listCount += 1;
            const values =
              scenario === "present"
                ? [stage(fixture)]
                : scenario === "list-race" && listCount === 2
                  ? [stage(fixture)]
                  : [];
            return { stdout: JSON.stringify(values) };
          },
          observePublicRelease: async () => {
            if (scenario === "config-race") {
              await writeFile(fixture.npmUserConfigPath, "changed=true\n");
            }
            return matchingPublicReleaseObservation(fixture);
          },
        });
        if (scenario === "present") assert.equal(result.stage.state, "present");
        else assert.equal(result.state, "unavailable");
        if (scenario === "list-race") assert.equal(result.reason, "stage_list_changed");
        if (scenario === "config-race") assert.equal(result.reason, "user_config_changed");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  });
});
