import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  assessCanonicalization,
  sha256,
  transitionCanonicalizationCandidate,
} from "@lervo/repository-knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

/** ADR-0561 slice A4: removed owner commands fail briefly and name their undo. */
describe("owner gates removed from canonicalization, delegation scope, and declarations", () => {
  let root = "";
  const output = { out: [] as string[], err: [] as string[] };
  const io = () => ({
    cwd: root,
    stdout: (value: string) => output.out.push(value),
    stderr: (value: string) => output.err.push(value),
  });
  const run = async (args: string[], stdin?: string) => {
    output.out.length = 0;
    output.err.length = 0;
    return runCli(args, stdin === undefined ? io() : { ...io(), stdin: async () => stdin });
  };

  beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), "lervo-owner-gates-"));
    expect(await runCli(["init"], { ...io(), stdout: () => undefined })).toBe(0);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each(["review", "promote"])(
    "removes canonicalization %s and points to reopen",
    async (action) => {
      expect(await run(["knowledge", "canonicalization", action, "kcanon_x"])).toBe(1);
      expect(output.err.join("")).toContain(
        "lervo knowledge canonicalization reopen <candidate-id>",
      );
    },
  );

  it("reopens a candidate the background reviewer decided, so it is reviewed again", async () => {
    await mkdir(resolve(root, "src"), { recursive: true });
    await writeFile(resolve(root, "src/value.ts"), "export const value = 1;\n");
    const { candidate } = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: {},
      afterFiles: { "src/value.ts": sha256("export const value = 1;\n") },
      disposition: "canonical_sources_current",
      now: new Date(),
    });
    await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: candidate!.candidateId,
      expectedContentHash: candidate!.contentHash,
      action: "reject",
      reviewerId: "agt_background_reviewer",
      now: new Date(),
    });
    expect(
      await run(["knowledge", "canonicalization", "reopen", candidate!.candidateId, "--json"]),
    ).toBe(0);
    expect(JSON.parse(output.out.join(""))).toMatchObject({
      observedState: "candidate",
      review: null,
    });
    expect(await run(["knowledge", "canonicalization", "reopen", candidate!.candidateId])).toBe(1);
    expect(output.err.join("")).toContain("already open for review");
  });

  it("removes delegation scope-response and points to the layout revert", async () => {
    expect(
      await run([
        "knowledge",
        "convergence",
        "delegation",
        "scope-response",
        "--proposal",
        "kscope_x",
        "--response",
        "accept",
      ]),
    ).toBe(1);
    expect(output.err.join("")).toContain("scope-response was removed");
    expect(output.err.join("")).toContain("lervo knowledge revert <commit>");
  });

  it.each(["canonicalizationDisposition", "knowledgeDisposition"])(
    "rejects a new %s of pending_user_approval before opening storage",
    async (field) => {
      const declaration = {
        taskMode: "change",
        canonicalizationDisposition: "canonical_sources_current",
        canonicalizationOutcome: null,
        knowledgeDisposition: "current",
        deliberationDisposition: "not_requested",
        deliberationId: null,
        [field]: "pending_user_approval",
      };
      expect(
        await run(
          [
            "terminal",
            "declare",
            "--provider",
            "codex",
            "--observation",
            "tobs_owner_gate_01",
            "--stdin",
          ],
          JSON.stringify(declaration),
        ),
      ).toBe(1);
      expect(output.err.join("")).toContain("pending_user_approval was removed");
      expect(output.err.join("")).toContain("pending_background");
    },
  );
});
