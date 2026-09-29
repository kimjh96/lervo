import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "vitest";

import {
  acquireRepositorySourceRead,
  acquireRepositorySourceWrite,
} from "../src/repository-source-gate.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-source-gate-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/state"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("admits concurrent live readers and excludes a knowledge writer until they settle", async () => {
  const root = await repository();
  const first = await acquireRepositorySourceRead(root);
  const second = await acquireRepositorySourceRead(root);
  await expect(acquireRepositorySourceWrite(root)).rejects.toMatchObject({
    code: "repository_source_busy",
  });
  first.release();
  second.release();

  const writer = await acquireRepositorySourceWrite(root);
  await expect(acquireRepositorySourceRead(root)).rejects.toMatchObject({
    code: "repository_source_busy",
  });
  writer.release();
  const next = await acquireRepositorySourceRead(root);
  next.release();
});

it("keeps live repository work out of an interrupted materialization until recovery", async () => {
  const root = await repository();
  const marker = resolve(root, ".lervo/state/knowledge/materialization-transaction");
  await mkdir(marker, { recursive: true });
  await expect(acquireRepositorySourceRead(root)).rejects.toMatchObject({
    code: "knowledge_recovery_required",
  });
  const recovery = await acquireRepositorySourceWrite(root);
  await rm(marker, { recursive: true });
  recovery.release();
  const reader = await acquireRepositorySourceRead(root);
  reader.release();
});

it("rejects WAL mode because it would let readers overlap an exclusive writer", async () => {
  const root = await repository();
  const initial = await acquireRepositorySourceRead(root);
  initial.release();
  const database = new DatabaseSync(resolve(root, ".lervo/data/repository-source-gate.sqlite"));
  database.exec("PRAGMA journal_mode = WAL");
  database.close();
  await expect(acquireRepositorySourceWrite(root)).rejects.toMatchObject({
    code: "repository_source_gate_invalid",
  });
});
