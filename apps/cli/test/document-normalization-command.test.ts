import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("document normalization CLI", () => {
  it("creates a stored provider candidate and applies exact approved rewrites", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-document-normalization-"));
    roots.push(root);
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/runtime.md"), "# Runtime notes\n\n## Start\n\nRun the runtime.\n");
    const executable = resolve(root, "codex-normalizer-fixture.mjs");
    await writeFile(executable, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("codex-normalizer-fixture 1.0.0"); process.exit(0); }
if (args[0] === "debug") { console.log("[]"); process.exit(0); }
let input = "";
for await (const chunk of process.stdin) input += chunk;
const parsed = JSON.parse(input);
const documents = parsed.envelope.documents.map((document) => ({ sourcePath: document.path, outputs: [{ path: document.path, content: "# Runtime\\n\\nStart the runtime, then verify readiness.\\n", coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index) }] }));
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "turn.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ schemaVersion: 1, documents }) } }));
console.log(JSON.stringify({ type: "turn.completed" }));
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = { cwd: root, stdout: (message: string) => messages.push(message), stderr: (message: string) => errors.push(message) };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;

    expect(await runCli(["knowledge", "normalize", "--provider", "codex", "--executable", executable, "--json"], io), errors.join(""),).toBe(0);
    const plan = JSON.parse(messages.join("")) as { planId: string; candidateId: string; candidateArtifactPath: string; items: Array<{ operationId: string; approvalHash: string }> };
    expect(plan.candidateArtifactPath).toContain(plan.candidateId);
    expect(plan.items).toHaveLength(1);
    messages.length = 0;
    const apply = ["knowledge", "normalize", "--candidate", plan.candidateId, "--apply", plan.planId, "--json"];
    for (const item of plan.items) apply.push("--approve-item", `${item.operationId}=${item.approvalHash}`);
    expect(await runCli(apply, io), errors.join("")).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ operation: "normalize_documents", normalizedDocumentCount: 1 });
    expect(await readFile(resolve(root, "docs/operations/runtime.md"), "utf8")).toContain("verify readiness");
    expect(errors).toEqual([]);
  }, 15_000);
});
