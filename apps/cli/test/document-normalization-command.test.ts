import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { planCrossCheck } from "./plan-cross-check-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("document normalization CLI", () => {
  it("creates a stored provider candidate and applies cross-checked rewrites", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-document-normalization-"));
    roots.push(root);
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(
      resolve(root, "docs/operations/runtime.md"),
      "# Runtime notes\n\n## Start\n\nRun the runtime.\n",
    );
    const executable = resolve(root, "codex-normalizer-fixture.mjs");
    const invocationLog = resolve(root, ".lervo/state/normalization-invocations.log");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("codex-normalizer-fixture 1.0.0"); process.exit(0); }
if (args[0] === "debug") { console.log("[]"); process.exit(0); }
appendFileSync(${JSON.stringify(invocationLog)}, "normalize\\n");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const parsed = JSON.parse(input);
const documents = parsed.envelope.documents.map((document) => ({ sourcePath: document.path, outputs: [{ path: document.path, content: "# Runtime\\n\\nStart the runtime, then verify readiness.\\n", coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index) }] }));
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "turn.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ schemaVersion: 1, documents }) } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 15, cached_input_tokens: 3, output_tokens: 4, reasoning_output_tokens: 1 } }));
`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o700);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;

    expect(
      await runCli(
        [
          "knowledge",
          "normalize",
          "--provider",
          "codex",
          "--executable",
          executable,
          "--scope",
          "all-pending",
          "--source",
          "docs/operations/runtime.md",
          "--max-observed-tokens",
          "1000",
          "--max-elapsed-ms",
          "5000",
          "--preflight",
          "--json",
        ],
        io,
      ),
      errors.join(""),
    ).toBe(0);
    const preflight = JSON.parse(messages.join("")) as {
      status: string;
      workset: {
        scope: string;
        selection: { kind: string };
        selectedDocuments: number;
      };
      selection: { cacheMisses: number };
      ceilings: { maximumObservedTokens: number; maximumElapsedMilliseconds: number };
    };
    expect(preflight).toMatchObject({
      status: "ready",
      workset: {
        scope: "all_pending",
        selection: { kind: "explicit_paths" },
        selectedDocuments: 1,
      },
      selection: { cacheMisses: 1 },
      ceilings: { maximumObservedTokens: 1000, maximumElapsedMilliseconds: 5000 },
    });
    await expect(access(invocationLog)).rejects.toMatchObject({ code: "ENOENT" });
    messages.length = 0;

    expect(
      await runCli(
        ["knowledge", "normalize", "--provider", "codex", "--executable", executable, "--json"],
        io,
      ),
      errors.join(""),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      candidateId: string;
      candidateArtifactPath: string;
      items: Array<{ operationId: string; approvalHash: string }>;
      resourceObservation: {
        providerCalls: number;
        elapsedMilliseconds: number;
        tokenUsage: { status: string; totalTokens: number };
      };
    };
    expect(plan.candidateArtifactPath).toContain(plan.candidateId);
    expect(plan.items).toHaveLength(1);
    expect(plan.resourceObservation).toMatchObject({
      providerCalls: 1,
      tokenUsage: { status: "observed", totalTokens: 19 },
    });
    messages.length = 0;
    const apply = [
      "knowledge",
      "normalize",
      "--candidate",
      plan.candidateId,
      "--apply",
      plan.planId,
      "--json",
    ];
    // ADR-0561: an independent cross-check of the stored candidate replaces item approvals.
    const crossCheck = planCrossCheck();
    expect(await runCli(apply, io, crossCheck.services), errors.join("")).toBe(0);
    expect(crossCheck.checked).toHaveLength(1);
    expect(crossCheck.checked[0]!.paths).toContain("docs/operations/runtime.md");
    expect(JSON.parse(messages.join(""))).toMatchObject({
      operation: "normalize_documents",
      normalizedDocumentCount: 1,
    });
    expect(await readFile(resolve(root, "docs/operations/runtime.md"), "utf8")).toContain(
      "verify readiness",
    );
    expect(errors).toEqual([
      "normalization shard 1/1: started (1 document)\n",
      "normalization shard 1/1: completed (0 cached, 1 generated)\n",
    ]);
  }, 15_000);
});
