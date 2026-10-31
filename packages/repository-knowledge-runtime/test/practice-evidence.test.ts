import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { retainPracticeEvidence } from "../src/practice-evidence.js";
import { readPracticeState, writePracticeState, PRACTICE_ROOT } from "../src/practice-store.js";
import { practice, work, now } from "./practice-fixture.js";
import { practiceContext } from "./practice-fixture.js";
import { settlePracticeAssessment } from "../src/practice-assessment.js";

const source = vi.hoisted(() => ({ content: "" }));
vi.mock("@lervo/repository-knowledge", async (load) => {
  const actual = await load<typeof import("@lervo/repository-knowledge")>();
  return {
    ...actual,
    scanConfiguredRepositoryKnowledge: async () => ({
      scan: {
        sources: [
          {
            path: "src/config.json",
            status: "included",
            content: source.content,
            contentHash: actual.sha256(source.content),
          },
        ],
      },
    }),
  };
});
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("retained disclosure boundaries", () => {
  it.each(["password", "token", "secret", "api_key", "authorization", "cookie", "private_key"])(
    "removes JSON %s from replies, file excerpts and owner excerpts before storage",
    async (key) => {
      const root = await mkdtemp(resolve(tmpdir(), "practice-evidence-"));
      roots.push(root);
      source.content = JSON.stringify({ nested: [{ [key]: "fixture-credential" }], safe: true });
      const observed = {
        ...work,
        reply: source.content,
        changedFiles: [{ path: "src/config.json", before: null, after: sha256(source.content) }],
      };
      const evidence = await retainPracticeEvidence(
        root,
        observed,
        { ...practice, sourcePaths: ["src/config.json"] },
        ["src"],
        { digest: sha256("owner"), excerpt: source.content },
        ["src/config.json"],
      );
      const serialized = canonicalJson(evidence);
      expect(serialized).not.toContain("fixture-credential");
      expect(evidence.work.reply).toContain("safe");
      const state = await readPracticeState(root);
      state.works.push(observed);
      await settlePracticeAssessment({
        context: practiceContext(root),
        state,
        work: observed,
        value: { ...practice, sourcePaths: ["src/config.json"] },
        readRoots: ["src"],
        readablePaths: ["src/config.json"],
        ownerResponse: { digest: sha256("owner"), excerpt: source.content },
      });
      await writePracticeState(root, state, now);
      expect(state.evidence).toHaveLength(1);
      expect(await readFile(resolve(root, PRACTICE_ROOT, "state.json"), "utf8")).not.toContain(
        "fixture-credential",
      );
    },
  );
  it("stores and hashes only the same scope projection used for assessment", async () => {
    const observed = {
      ...work,
      reply: "Read src/visible.ts.\nDo not disclose excluded/hidden.ts.",
      changedFiles: [{ path: "excluded/hidden.ts", before: null, after: sha256("excluded-hash") }],
      steps: [{ ...work.steps[0]!, paths: ["src/visible.ts", "excluded/hidden.ts"] }],
    };
    const evidence = await retainPracticeEvidence(
      "/unused",
      observed,
      practice,
      ["src"],
      undefined,
      ["src/visible.ts"],
    );
    expect(canonicalJson(evidence)).not.toContain("excluded");
    expect(canonicalJson(evidence)).not.toContain(sha256("excluded-hash"));
    const { evidenceHash, ...bundle } = evidence;
    expect(evidenceHash).toBe(sha256(canonicalJson(bundle)));
    expect(evidence.work.steps[0]!.paths).toEqual(["src/visible.ts"]);
  });
});
