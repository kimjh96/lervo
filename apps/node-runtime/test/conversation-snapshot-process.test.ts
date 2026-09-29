import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { createConversationSnapshotProcessCapture } from "../src/conversation-snapshot-process.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps the conversation event loop responsive while a real child captures evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-conversation-snapshot-"));
  roots.push(root);
  const entry = join(root, "worker.mjs");
  await writeFile(
    entry,
    `process.once('message', () => {
      const until = Date.now() + 500;
      while (Date.now() < until) {}
      process.send({ type: 'snapshot_result', snapshot: { revision: 'observed', files: { 'src/a.ts': 'sha256:observed' } } }, () => process.disconnect());
    });`,
  );
  const capture = createConversationSnapshotProcessCapture(entry);
  const started = Date.now();
  const pending = capture(root);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(Date.now() - started).toBeLessThan(400);
  await expect(pending).resolves.toEqual({
    revision: "observed",
    files: { "src/a.ts": "sha256:observed" },
  });
});

it("fails closed when the child exits without verified snapshot evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-conversation-snapshot-failed-"));
  roots.push(root);
  const entry = join(root, "worker.mjs");
  await writeFile(entry, "process.exit(1);\n");
  await expect(createConversationSnapshotProcessCapture(entry)(root)).rejects.toThrow(
    "Could not complete the repository snapshot worker.",
  );
});

it("preserves bounded path-safety failure meaning across the child boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-conversation-snapshot-limit-"));
  roots.push(root);
  const entry = join(root, "worker.mjs");
  await writeFile(
    entry,
    "process.once('message', () => process.send({ type: 'snapshot_error', message: 'The repository snapshot byte limit was exceeded.' }, () => process.disconnect()));\n",
  );
  await expect(createConversationSnapshotProcessCapture(entry)(root)).rejects.toThrow(
    "The repository snapshot byte limit was exceeded.",
  );
});
