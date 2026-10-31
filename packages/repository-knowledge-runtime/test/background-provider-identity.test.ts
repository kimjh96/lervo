import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectStorage } from "@lervo/project-storage";
import { createProcessDocumentNormalizationCompiler } from "@lervo/repository-knowledge-compiler";
import {
  admittedBackgroundContext,
  backgroundProviderOptions,
} from "../src/background-provider.js";
import { identifyProviderCli } from "../src/provider-cli-identity.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";
import { resolveAdmittedProviderCli } from "../src/provider-cli-admission.js";
import { readWorkerProviderSelection } from "../src/provider-cli-selection.js";

vi.mock("../src/provider-cli-admission.js", () => ({ resolveAdmittedProviderCli: vi.fn() }));
vi.mock("../src/delegation.js", () => ({
  assertConvergenceDelegation: vi.fn(),
  loadConvergenceDelegation: async () => ({
    contentHash: `sha256:${"a".repeat(64)}`,
    delegation: {
      state: "active",
      projectId: "prj_identity",
      expiresAt: "2099-01-01T00:00:00Z",
      providers: ["claude"],
      resourceCeilings: { maximumProviderCalls: 8 },
    },
  }),
}));
vi.mock("../src/convergence-owner-host.js", () => ({ readConvergenceOwnerHost: async () => null }));
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(["executable", "dispatch"])(
  "stops an existing compiler after %s replacement, readmits and rebuilds its descriptor",
  async (change) => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-identity-guard-"));
    roots.push(home);
    const executable = resolve(home, "claude");
    const versionFile = resolve(home, "selected-version");
    const callLog = resolve(home, "model-calls");
    await writeFile(versionFile, "1.0.0");
    const script = (version: string) => `#!${process.execPath}
import {readFileSync, appendFileSync} from 'node:fs';
if (process.argv.includes('--version')) { console.log(${change === "dispatch" ? `readFileSync('${versionFile}', 'utf8')` : `'${version}'`}); process.exit(0); }
appendFileSync('${callLog}', 'model\\n');
console.log(JSON.stringify({is_error:false,result:'{"schemaVersion":1,"documents":[]}',structured_output:{schemaVersion:1,documents:[]},stop_reason:'tool_use',num_turns:2,permission_denials:[],modelUsage:{test:{inputTokens:10,cacheReadInputTokens:0,cacheCreationInputTokens:0,outputTokens:5,contextWindow:200000}}}));
`;
    await writeFile(executable, script("1.0.0"), { mode: 0o700 });
    const ports = { home, shell: "/bin/sh", command: runProviderCliCommand };
    const environment = { HOME: home, SHELL: "/bin/sh", PATH: "/usr/bin:/bin" };
    const initial = (await identifyProviderCli("claude", executable, ports, environment))!;
    const context = {
      storage: {
        paths: { repositoryRoot: home },
        manifest: { projectId: "prj_identity" },
      } as ProjectStorage,
      provider: "claude" as const,
      liveWorkPending: async () => false,
    };
    vi.mocked(resolveAdmittedProviderCli).mockResolvedValue({
      selected: initial,
      projection: {
        observedAt: new Date().toISOString(),
        detectionFailure: null,
        providers: [],
        selected: null,
        waiting: false,
      },
    });
    const admitted = await admittedBackgroundContext(context);
    const options = backgroundProviderOptions(admitted);
    const compiler = await createProcessDocumentNormalizationCompiler(options);
    expect(await readWorkerProviderSelection(home)).toBeNull();
    const envelope = { documents: [] } as unknown as Parameters<typeof compiler.normalize>[0];
    const signal = new AbortController().signal;
    await compiler.normalize(envelope, signal);
    expect(await readWorkerProviderSelection(home)).toEqual({
      provider: "claude",
      version: "1.0.0",
    });
    if (change === "dispatch") await writeFile(versionFile, "2.0.0");
    else await writeFile(executable, script("2.0.0"));
    const replacement = (await identifyProviderCli(
      "claude",
      executable,
      ports,
      environment,
      initial,
    ))!;
    if (change === "dispatch") {
      expect(replacement.fingerprint).toBe(initial.fingerprint);
      expect(replacement.executableHash).toBe(initial.executableHash);
      expect(replacement.versionOutputHash).not.toBe(initial.versionOutputHash);
      expect(replacement.identityHash).not.toBe(initial.identityHash);
    }
    vi.mocked(resolveAdmittedProviderCli).mockResolvedValue({
      selected: replacement,
      projection: {
        observedAt: new Date().toISOString(),
        detectionFailure: null,
        providers: [],
        selected: null,
        waiting: false,
      },
    });
    await expect(compiler.normalize(envelope, signal)).rejects.toMatchObject({
      code: "provider_not_admitted",
    });
    expect(resolveAdmittedProviderCli).toHaveBeenCalledTimes(2);
    expect((await readFile(callLog, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(await readWorkerProviderSelection(home)).toEqual({
      provider: "claude",
      version: "1.0.0",
    });
    const rebuilt = await createProcessDocumentNormalizationCompiler(
      backgroundProviderOptions(await admittedBackgroundContext(context)),
    );
    expect(rebuilt.descriptor.compilerBuildId).not.toBe(compiler.descriptor.compilerBuildId);
    await rebuilt.normalize(envelope, signal);
    expect((await readFile(callLog, "utf8")).trim().split("\n")).toHaveLength(2);
    expect(await readWorkerProviderSelection(home)).toEqual({
      provider: "claude",
      version: "2.0.0",
    });
  },
);
