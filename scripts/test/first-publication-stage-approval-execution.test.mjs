import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createFileFirstPublicationStageApprovalStore } from "../lib/file-first-publication-stage-approval-store.mjs";
import { validateFirstPublicationStageApprovalAuthorization } from "../lib/first-publication-stage-approval-authorization.mjs";
import { executeFirstPublicationStageApproval } from "../lib/first-publication-stage-approval-execution.mjs";
import { createFirstPublicationStageApprovalFixture } from "./fixtures/first-publication-stage-approval.mjs";

function sequenceClock(...values) {
  return () => values.shift();
}

function input(fixture, events) {
  return {
    authorization: fixture.authorization,
    validateAuthorization: (checkedAt) =>
      validateFirstPublicationStageApprovalAuthorization(
        fixture.authorization,
        fixture.authorizationInput,
        { checkedAt },
      ),
    assertUnchanged: async () => events.push("source"),
  };
}

describe("first-publication stage approval execution", () => {
  it("persists the attempt before the only approve call and a success terminal after", async () => {
    const fixture = await createFirstPublicationStageApprovalFixture();
    const resultDirectory = resolve(fixture.root, "approval-result");
    const events = [];
    try {
      const terminal = await executeFirstPublicationStageApproval(input(fixture, events), {
        store: createFileFirstPublicationStageApprovalStore({ rootDirectory: resultDirectory }),
        prepareApproval: async () => ({
          recheck: async () => events.push("recheck"),
          approve: async () => {
            events.push("approve");
            const attempt = JSON.parse(
              await readFile(resolve(resultDirectory, "attempt.json"), "utf8"),
            );
            assert.equal(attempt.state, "reserved");
          },
          dispose: async () => events.push("dispose"),
        }),
        clock: sequenceClock(
          "2026-08-21T10:16:31Z",
          "2026-08-21T10:17:00Z",
          "2026-08-21T10:17:01Z",
          "2026-08-21T10:18:00Z",
        ),
      });
      assert.equal(terminal.state, "approval_command_completed");
      assert.equal(terminal.receipt.evidence, "npm_cli_exit_zero");
      assert.deepEqual(events, ["source", "recheck", "source", "approve", "source", "dispose"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("records pre-call failures as abort and post-call failures as unknown", async () => {
    for (const scenario of ["pre", "post"]) {
      const fixture = await createFirstPublicationStageApprovalFixture();
      const resultDirectory = resolve(fixture.root, `approval-${scenario}`);
      try {
        await assert.rejects(
          executeFirstPublicationStageApproval(input(fixture, []), {
            store: createFileFirstPublicationStageApprovalStore({ rootDirectory: resultDirectory }),
            prepareApproval: async () => ({
              recheck: async () => {
                if (scenario === "pre") throw new Error("stage moved");
              },
              approve: async () => {
                throw new Error("response lost");
              },
              dispose: async () => {},
            }),
            clock: sequenceClock(
              "2026-08-21T10:16:31Z",
              "2026-08-21T10:17:00Z",
              "2026-08-21T10:17:01Z",
              "2026-08-21T10:18:00Z",
            ),
          }),
          scenario === "post"
            ? { code: "first_publication_stage_approval_outcome_unknown" }
            : /stage moved/u,
        );
        const terminal = JSON.parse(
          await readFile(resolve(resultDirectory, "terminal.json"), "utf8"),
        );
        assert.equal(
          terminal.state,
          scenario === "pre" ? "aborted_before_approval" : "approval_outcome_unknown",
        );
        assert.equal(
          terminal.retry,
          scenario === "pre" ? "new_authorization_required" : "forbidden",
        );
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  });
});
