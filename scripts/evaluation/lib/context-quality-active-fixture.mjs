import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export const fixtureText = (generation) =>
  `# Runtime\n## Background\n${"noise ".repeat(5300)}\n## Cancellation\nKeep other waiters alive ${String(generation).padStart(3, "0")}.\n## Exceptions\nDo not reuse stale sources.\n`;

export async function stateBytes(root) {
  let size = 0;
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) size += (await stat(child)).size;
      else throw new Error("Unexpected fixture entry.");
    }
  }
  for (const entry of await readdir(resolve(root, ".lervo"), { withFileTypes: true })) {
    if (!["data", "state"].includes(entry.name)) continue;
    if (!entry.isDirectory()) throw new Error("Unexpected fixture storage entry.");
    await visit(resolve(root, ".lervo", entry.name));
  }
  return size;
}
export async function initializeActiveFixture(root) {
  const {
    applyInitPlan,
    createInitPlan,
    planEventWriterActivation,
    applyEventWriterActivationPlan,
  } = await import("../../../packages/project/dist/index.js");
  const { createEventReaderCapabilities } =
    await import("../../../packages/event-contract/dist/index.js");
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "README.md"), fixtureText(0));
  await writeFile(resolve(root, "result.txt"), "good");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_activeperf" }));
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  await writeFile(
    resolve(root, `docs/instructions/generated/rule_${"a".repeat(24)}.md`),
    "# Rule\nPreserve exact source hashes.\n",
  );
  const evidence = {
    schemaVersion: 1,
    projectId: "prj_activeperf",
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_fixture01",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const plan = await planEventWriterActivation({
    repositoryRoot: root,
    targetEventSchemaVersion: 6,
    evidence,
  });
  await applyEventWriterActivationPlan({ plan, approval: plan.planId, currentEvidence: evidence });
}
