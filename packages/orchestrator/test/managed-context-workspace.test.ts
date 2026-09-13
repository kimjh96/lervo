import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  hash,
  injectFixtureContext,
  role,
  targetDigest,
} from "./fixture.js";

afterEach(cleanupManagedFixtures);

it.each([false, true])(
  "keeps context freshness and target bytes separate (changed source: %s)",
  async (changedSource) => {
    const source = await createManagedFixture();
    const worker = await createManagedFixture();
    try {
      await writeFile(resolve(source.root, "src/result.ts"), "control\n");
      await writeFile(resolve(worker.root, "src/result.ts"), "worker\n");
      const run = source.createRun();
      const input = {
        repositoryRoot: source.root,
        writeRepositoryRoot: worker.root,
        sourceRevision: "working-tree:governance-source",
        registry: { schemaVersion: 1 as const, documents: {} },
        role,
        expectedPaths: ["src/result.ts"],
        documentRules: {},
        publications: [],
        handoffs: [],
        recordedAt: new Date("2026-08-18T01:01:00Z"),
      };
      await run.prepareContext(input);
      await injectFixtureContext(run, source.session);
      if (changedSource) await writeFile(resolve(source.root, "AGENTS.md"), "Changed authority.\n");
      const decision = await run.authorizeFileWrite({
        path: "src/result.ts",
        targetDigest,
        risk: "low",
        publications: [],
        occurredAt: new Date("2026-08-18T01:04:00Z"),
      });
      expect(decision.allowed).toBe(!changedSource);
      if (!decision.allowed) return;
      expect(decision.permit.expectedBeforeHash).toBe(hash("worker\n"));
      await writeFile(resolve(worker.root, "src/result.ts"), "verified\n");
      await run.recordFileChange({
        permit: decision.permit,
        path: "src/result.ts",
        beforeHash: hash("worker\n"),
        afterHash: hash("verified\n"),
        changeKind: "modified",
        occurredAt: new Date("2026-08-18T01:05:00Z"),
      });
      expect(await readFile(resolve(source.root, "src/result.ts"), "utf8")).toBe("control\n");
      await expect(
        run.prepareContext({
          ...input,
          writeRepositoryRoot: source.root,
          recordedAt: new Date("2026-08-18T01:06:00Z"),
        }),
      ).rejects.toThrow(/cannot change/);
    } finally {
      source.store.close();
      worker.store.close();
    }
  },
);
