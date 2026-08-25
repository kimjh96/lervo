import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createFileFirstPublicationStageApprovalStore } from "../lib/file-first-publication-stage-approval-store.mjs";
import {
  bindFirstPublicationStageApprovalTerminal,
  createFirstPublicationStageApprovalAttempt,
  createFirstPublicationStageApprovalReceipt,
  createFirstPublicationStageApprovalTerminal,
  validateFirstPublicationStageApprovalAttempt,
  validateFirstPublicationStageApprovalTerminal,
} from "../lib/first-publication-stage-approval-records.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { createFirstPublicationStageApprovalFixture } from "./fixtures/first-publication-stage-approval.mjs";

describe("first-publication stage approval durable records", () => {
  it("stores one immutable attempt and one separate success terminal", async () => {
    const fixture = await createFirstPublicationStageApprovalFixture();
    const resultDirectory = resolve(fixture.root, "approval-result");
    try {
      const attempt = createFirstPublicationStageApprovalAttempt({
        authorization: fixture.authorization,
        reservedAt: "2026-08-21T10:17:00Z",
      });
      const store = createFileFirstPublicationStageApprovalStore({
        rootDirectory: resultDirectory,
      });
      assert.deepEqual(await store.reserve(attempt), attempt);
      const receipt = createFirstPublicationStageApprovalReceipt(attempt);
      const terminal = createFirstPublicationStageApprovalTerminal({
        attempt,
        state: "approval_command_completed",
        completedAt: "2026-08-21T10:18:00Z",
        receipt,
      });
      assert.deepEqual(await store.complete(terminal), terminal);
      assert.equal(validateFirstPublicationStageApprovalAttempt(attempt), attempt);
      assert.equal(validateFirstPublicationStageApprovalTerminal(terminal), terminal);
      assert.equal(bindFirstPublicationStageApprovalTerminal(terminal, attempt), terminal);
      assert.equal(terminal.publicAvailability, "not_claimed");
      assert.equal(terminal.verification, "authenticated_public_registry_required");
      assert.equal((await stat(resultDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(resolve(resultDirectory, "attempt.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(resolve(resultDirectory, "terminal.json"))).mode & 0o777, 0o600);
      assert.deepEqual(
        JSON.parse(await readFile(resolve(resultDirectory, "attempt.json"), "utf8")),
        attempt,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("represents pre-call abort and unknown post-call outcome without retry authority", async () => {
    const fixture = await createFirstPublicationStageApprovalFixture();
    try {
      const attempt = createFirstPublicationStageApprovalAttempt({
        authorization: fixture.authorization,
        reservedAt: "2026-08-21T10:17:00Z",
      });
      const aborted = createFirstPublicationStageApprovalTerminal({
        attempt,
        state: "aborted_before_approval",
        completedAt: "2026-08-21T10:17:01Z",
      });
      const unknown = createFirstPublicationStageApprovalTerminal({
        attempt,
        state: "approval_outcome_unknown",
        completedAt: "2026-08-21T10:18:00Z",
      });
      assert.equal(aborted.retry, "new_authorization_required");
      assert.equal(unknown.retry, "forbidden");
      assert.equal(unknown.reconciliation, "authenticated_public_release_observation_required");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects terminal overwrite, attempt reuse, binding changes, and redigested public claims", async () => {
    const fixture = await createFirstPublicationStageApprovalFixture();
    const resultDirectory = resolve(fixture.root, "approval-result");
    try {
      const attempt = createFirstPublicationStageApprovalAttempt({
        authorization: fixture.authorization,
        reservedAt: "2026-08-21T10:17:00Z",
      });
      const store = createFileFirstPublicationStageApprovalStore({
        rootDirectory: resultDirectory,
      });
      await store.reserve(attempt);
      await assert.rejects(store.reserve(attempt), {
        code: "first_publication_stage_approval_already_attempted",
      });
      const terminal = createFirstPublicationStageApprovalTerminal({
        attempt,
        state: "approval_outcome_unknown",
        completedAt: "2026-08-21T10:18:00Z",
      });
      await store.markUnknown(terminal);
      await assert.rejects(
        store.complete(
          createFirstPublicationStageApprovalTerminal({
            attempt,
            state: "aborted_before_approval",
            completedAt: "2026-08-21T10:18:01Z",
          }),
        ),
        { code: "first_publication_stage_approval_already_terminal" },
      );
      const forged = structuredClone(terminal);
      forged.retry = "allowed";
      const { terminalDigest: _digest, ...body } = forged;
      forged.terminalDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationStageApprovalTerminal(forged), {
        code: "first_publication_stage_approval_terminal_invalid",
      });
      const otherAttempt = structuredClone(attempt);
      otherAttempt.authorizationDigest = `sha256:${"f".repeat(64)}`;
      const { attemptDigest: _attemptDigest, ...attemptBody } = otherAttempt;
      otherAttempt.attemptDigest = canonicalDigest(attemptBody);
      assert.throws(() => bindFirstPublicationStageApprovalTerminal(terminal, otherAttempt), {
        code: "first_publication_stage_approval_terminal_conflict",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
