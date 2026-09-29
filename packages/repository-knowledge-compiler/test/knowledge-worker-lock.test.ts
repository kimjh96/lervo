import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { acquireKnowledgeWorkerLock } from "../src/knowledge-worker-lock.js";

it("admits one owner and releases only its exact token across replacement and repeated release", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-worker-lock-"));
  try {
    const first = await acquireKnowledgeWorkerLock(root);
    expect(first).not.toBeNull();
    expect(await acquireKnowledgeWorkerLock(root)).toBeNull();
    const path = resolve(root, ".lervo/state/knowledge-worker.lock");
    const replacement = `${process.pid}\nreplacement-token\n`;
    await writeFile(path, replacement);
    await first!();
    await first!();
    expect(await readFile(path, "utf8")).toBe(replacement);
    expect(await acquireKnowledgeWorkerLock(root)).toBeNull();
    await rm(path);
    const next = await acquireKnowledgeWorkerLock(root);
    expect(next).not.toBeNull();
    await next!();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reclaims a dead legacy owner under serialization but preserves a live legacy PID lock", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-worker-lock-"));
  try {
    await mkdir(resolve(root, ".lervo/state"), { recursive: true });
    const path = resolve(root, ".lervo/state/knowledge-worker.lock");
    await writeFile(path, `${process.pid}\n`);
    expect(await acquireKnowledgeWorkerLock(root)).toBeNull();
    await writeFile(path, "2147483647\n");
    const attempts = await Promise.all([
      acquireKnowledgeWorkerLock(root),
      acquireKnowledgeWorkerLock(root),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    await attempts.find(Boolean)!();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
