import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  KnowledgeProviderAvailabilityError,
  probeProviderCli,
  createNoCapabilityProviderJsonRunner,
} from "@lervo/repository-knowledge-compiler";
import { recordTurnMeasurement } from "@lervo/execution-contract";
import { probeBackgroundProviderCli } from "../src/provider-cli-probe-budget.js";
import {
  acquireKnowledgeProviderAdmission,
  pauseKnowledgeProvider,
  knowledgeProviderAdmissionState,
} from "../src/provider-admission.js";
import { reserveConvergenceProviderCall } from "../src/provider-budget.js";
import type { ProviderCliIdentity } from "../src/provider-cli-identity.js";
import { resolveAdmittedProviderCli } from "../src/provider-cli-admission.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";
import { backgroundProviderOptions } from "../src/background-provider-invocation.js";
import { readWorkerProviderSelection } from "../src/provider-cli-selection.js";
import { providerOutputSchema } from "@lervo/schemas";

vi.mock("@lervo/repository-knowledge-compiler", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge-compiler")>()),
  probeProviderCli: vi.fn(),
}));
vi.mock("@lervo/execution-contract", async (original) => ({
  ...(await original<typeof import("@lervo/execution-contract")>()),
  recordTurnMeasurement: vi.fn(),
}));
vi.mock("../src/provider-admission.js", () => ({
  acquireKnowledgeProviderAdmission: vi.fn(),
  pauseKnowledgeProvider: vi.fn(),
  knowledgeProviderAdmissionState: vi.fn(),
  settleKnowledgeProviderProbe: vi.fn(),
}));
vi.mock("../src/provider-budget.js", () => ({ reserveConvergenceProviderCall: vi.fn() }));
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const usage = {
  inputTokens: 10,
  cachedInputTokens: 0,
  outputTokens: 5,
  reasoningOutputTokens: 0,
  totalTokens: 15,
  contextWindow: 200000,
};
function input() {
  vi.mocked(knowledgeProviderAdmissionState).mockResolvedValue({
    paused: false,
    observationHash: null,
    observedAt: null,
    resetAt: null,
    activeCalls: 0,
    reason: null,
    nextReprobeAt: null,
  });
  const release = vi.fn(async () => {});
  vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
    observationHash: `sha256:${"a".repeat(64)}`,
    release,
  });
  const identity: ProviderCliIdentity = {
    provider: "claude",
    executable: "/installed/claude",
    realPath: "/installed/claude",
    fingerprint: "1:2:3:4",
    versionOutputHash: null,
    environment: { HOME: "/home/owner", SHELL: "/bin/sh", PATH: "/usr/bin:/bin" },
    version: "2.1.308",
    executableHash: `sha256:${"b".repeat(64)}`,
    identityHash: `sha256:${"c".repeat(64)}`,
  };
  return {
    storage: {
      paths: { repositoryRoot: "/repo" },
      manifest: { projectId: "prj_probe" },
      events: {},
    } as unknown as ProjectStorage,
    identity,
    delegationHash: `sha256:${"d".repeat(64)}`,
    maximumCalls: 8,
    liveWorkPending: async () => false,
    admissionDirectory: "/private/admission",
    release,
  };
}
it("reserves paid probe spend before calling Claude and records its native usage", async () => {
  const f = input();
  vi.mocked(probeProviderCli).mockImplementation(async (request) => {
    expect(reserveConvergenceProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        maximumCalls: 8,
        batchId: `provider-cli-admission:${f.delegationHash}`,
      }),
    );
    await request.observeUsage?.(usage);
    return { admitted: true, probeResultHash: `sha256:${"e".repeat(64)}` };
  });
  expect((await probeBackgroundProviderCli(f)).admitted).toBe(true);
  expect(recordTurnMeasurement).toHaveBeenCalledTimes(1);
  expect(acquireKnowledgeProviderAdmission).toHaveBeenCalledWith(
    expect.not.objectContaining({ purpose: "availability_probe" }),
  );
  expect(f.release).toHaveBeenCalledTimes(1);
});
it.each(["quota", "authentication"] as const)(
  "pauses %s failures without bypassing the pause contract",
  async (reason) => {
    const f = input();
    const failure = new KnowledgeProviderAvailabilityError(
      reason,
      `sha256:${"f".repeat(64)}`,
      null,
    );
    vi.mocked(probeProviderCli).mockImplementation(async (request) => {
      await request.observeUsage?.(null);
      throw failure;
    });
    await expect(probeBackgroundProviderCli(f)).rejects.toBe(failure);
    expect(pauseKnowledgeProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", reason, resetAt: null }),
    );
    expect(recordTurnMeasurement).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
    vi.mocked(acquireKnowledgeProviderAdmission).mockRejectedValue(
      Object.assign(new Error("paused"), { code: "knowledge_provider_paused" }),
    );
    await expect(probeBackgroundProviderCli(f)).rejects.toMatchObject({
      code: "knowledge_provider_paused",
    });
    expect(probeProviderCli).toHaveBeenCalledTimes(1);
  },
);
it("records unavailable usage and rejects admission so retries receive cached backoff", async () => {
  const f = input();
  vi.mocked(probeProviderCli).mockImplementation(async (request) => {
    await request.observeUsage?.(null);
    return { admitted: true, probeResultHash: `sha256:${"e".repeat(64)}` };
  });
  expect(await probeBackgroundProviderCli(f)).toMatchObject({
    admitted: false,
    reason: "probe_failed",
  });
  expect(recordTurnMeasurement).toHaveBeenCalledTimes(1);
});
it("does not spend when reservation or host admission fails", async () => {
  const f = input();
  vi.mocked(reserveConvergenceProviderCall).mockRejectedValue(
    Object.assign(new Error("budget"), { code: "normalization_budget_exceeded" }),
  );
  await expect(probeBackgroundProviderCli(f)).rejects.toMatchObject({
    code: "normalization_budget_exceeded",
  });
  expect(probeProviderCli).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledTimes(1);
});

it.each(["quota", "authentication", "already_paused"] as const)(
  "admits and executes allowed Codex when preferred Claude is %s",
  async (reason) => {
    const f = input();
    const home = await mkdtemp(resolve(tmpdir(), "lervo-paused-fallback-"));
    roots.push(home);
    const bin = resolve(home, ".local/bin");
    await mkdir(bin, { recursive: true });
    const codex = resolve(bin, "codex");
    const claude = resolve(bin, "claude");
    const calls = resolve(home, "codex-calls");
    await writeFile(claude, "#!/bin/sh\necho 2.1.308\n", { mode: 0o700 });
    await writeFile(
      codex,
      `#!${process.execPath}
import {appendFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('0.156.1');process.exit(0);}
if(process.argv.includes('debug')){console.log('[]');process.exit(0);}
for await(const chunk of process.stdin){}
appendFileSync('${calls}', 'called');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"ok":true}'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}));
`,
      { mode: 0o700 },
    );
    const storage = {
      ...f.storage,
      paths: { repositoryRoot: home },
      writableEventSchemaVersion: 4,
      events: { get: () => null, append: vi.fn() },
    } as unknown as ProjectStorage;
    vi.mocked(acquireKnowledgeProviderAdmission).mockImplementation(async ({ provider }) => {
      if (provider === "claude" && reason === "already_paused")
        throw Object.assign(new Error("paused"), { code: "knowledge_provider_paused" });
      return { observationHash: `sha256:${"a".repeat(64)}`, release: f.release };
    });
    vi.mocked(probeProviderCli).mockImplementation(async (request) => {
      if (request.provider === "claude") {
        await request.observeUsage?.(null);
        throw new KnowledgeProviderAvailabilityError(
          reason === "authentication" ? reason : "quota",
          `sha256:${"f".repeat(64)}`,
          null,
        );
      }
      return { admitted: true, probeResultHash: `sha256:${"e".repeat(64)}` };
    });
    const result = await resolveAdmittedProviderCli({
      storage,
      preferred: "claude",
      allowed: ["claude", "codex"],
      directory: resolve(home, "cache"),
      ports: { home, shell: "/missing-shell", prefixes: [], command: runProviderCliCommand },
      probe: (identity) => probeBackgroundProviderCli({ ...f, storage, identity }),
    });
    expect(result.selected?.provider).toBe("codex");
    if (reason === "already_paused") expect(pauseKnowledgeProvider).not.toHaveBeenCalled();
    else
      expect(pauseKnowledgeProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claude", reason, resetAt: null }),
      );
    expect(result.projection.providers).toContainEqual(
      expect.objectContaining({ provider: "claude", admitted: false, reason: null }),
    );
    const runner = await createNoCapabilityProviderJsonRunner(
      backgroundProviderOptions({
        storage,
        provider: "codex",
        providerCliIdentity: result.selected!,
      }),
    );
    expect(
      await runner.resolve({
        task: "background",
        responseContract: {
          schema: providerOutputSchema({
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          }),
        },
      }),
    ).toEqual({ ok: true });
    expect(await readFile(calls, "utf8")).toBe("called");
    expect(await readWorkerProviderSelection(home)).toEqual({
      provider: "codex",
      version: "0.156.1",
    });
    expect(
      vi.mocked(probeProviderCli).mock.calls.filter(([request]) => request.provider === "claude"),
    ).toHaveLength(reason === "already_paused" ? 0 : 1);
  },
);
