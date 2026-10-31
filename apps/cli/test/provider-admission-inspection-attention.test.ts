import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { CONVERGENCE_DELEGATION_PATH } from "@lervo/repository-knowledge-runtime";
import * as sqlite from "@lervo/sqlite-connection";
import { afterEach, expect, it, vi } from "vitest";
import {
  knowledgeConvergenceAttentionItems,
  readKnowledgeConvergenceAttention,
} from "../src/knowledge-convergence-attention.js";

vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  return { ...os, homedir: vi.fn(os.homedir) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("keeps continuity attention visible when the host admission database cannot be read", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-admission-attention-"));
  roots.push(root);
  vi.mocked(homedir).mockReturnValue(root);
  vi.stubEnv("HOME", root);
  for (const [path, content] of [
    [CONVERGENCE_DELEGATION_PATH, "{"],
    [".lervo/state/knowledge-provider-admission/admission.sqlite", "unavailable"],
  ] as const) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600 });
  }
  const open = vi.spyOn(sqlite, "openSqliteDatabase").mockImplementation(() => {
    throw Object.assign(new Error("read unavailable"), { code: "EACCES" });
  });
  const attention = await readKnowledgeConvergenceAttention(root, "prj_attention");
  expect(open).toHaveBeenCalled();
  expect(attention.continuity).not.toBeNull();
  expect(knowledgeConvergenceAttentionItems(attention)).toContainEqual(
    expect.objectContaining({
      kind: "knowledge_convergence_continuity",
      findingCode: "delegation_invalid",
    }),
  );
});
