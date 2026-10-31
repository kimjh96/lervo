import * as processHost from "../src/process-host.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  probeProviderCli,
  createNoCapabilityProviderJsonRunner,
  createProcessDocumentNormalizationCompiler,
  CODEX_NO_CAPABILITY_DISABLED_FEATURES,
  providerCliDispatchContext,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function provider(provider: "codex" | "claude", tools = false) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-probe-"));
  roots.push(root);
  const executable = resolve(root, `${provider}.mjs`);
  const log = resolve(root, "arguments.json");
  await writeFile(
    executable,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));
if (args[0] === '--version') console.log('1.2.3');
else if (args[0] === 'debug') console.log(JSON.stringify(${tools ? '[{type:"additional_tools", tools:[{name:"exec"},{name:"spawn_agent"},{name:"private/path-token"}]}]' : '[{type:"message"}]'}));
else { const structured=args.includes('--json-schema'); console.log(JSON.stringify({ is_error:false, result:'{"ok":true}', ...(structured?{structured_output:{ok:true}}:{}), stop_reason:structured?'tool_use':${JSON.stringify(tools ? "tool_use" : "end_turn")}, num_turns:structured?3:${tools ? 2 : 1}, permission_denials:[], usage:{server_tool_use:{web_search_requests:0,web_fetch_requests:0}} })); }
`,
    { mode: 0o700 },
  );
  return { root, executable, log, provider };
}
it("rejects Codex additional_tools with bounded closed names using every existing feature disable", async () => {
  const f = await provider("codex", true);
  const result = await probeProviderCli(f);
  expect(result).toEqual({
    admitted: false,
    reason: "capabilities_exposed",
    exposedTools: ["exec", "other", "spawn_agent"],
  });
  const args = JSON.parse(await readFile(f.log, "utf8"));
  expect(args.slice(0, 2)).toEqual(["debug", "prompt-input"]);
  for (const feature of CODEX_NO_CAPABILITY_DISABLED_FEATURES) expect(args).toContain(feature);
  expect(JSON.stringify(result)).not.toContain("private/path-token");
});
it.each(["codex", "claude"] as const)(
  "admits %s only on the existing no-capability contract",
  async (name) => {
    const f = await provider(name);
    expect(await probeProviderCli(f)).toEqual({
      admitted: true,
      probeResultHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  },
);
it("rejects reported Claude tool use and preserves empty tools, MCP and settings flags", async () => {
  const f = await provider("claude", true);
  expect(await probeProviderCli(f)).toMatchObject({
    admitted: false,
    reason: "capabilities_exposed",
  });
  const args: string[] = JSON.parse(await readFile(f.log, "utf8"));
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
  expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
  expect(args).toContain("--strict-mcp-config");
  expect(args).toContain("--safe-mode");
});
it("the admitted fallback executes a capability-free background turn", async () => {
  const codex = await provider("codex", true);
  const claude = await provider("claude");
  expect((await probeProviderCli(codex)).admitted).toBe(false);
  expect((await probeProviderCli(claude)).admitted).toBe(true);
  const runner = await createNoCapabilityProviderJsonRunner(claude);
  expect(
    await runner.resolve({
      responseContract: {
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
      task: "background_assessment",
    }),
  ).toEqual({ ok: true });
});

it.each(["codex", "claude"] as const)(
  "rejects a timed-out %s admission probe within its deadline",
  async (provider) => {
    const process = vi
      .spyOn(processHost, "runProcess")
      .mockResolvedValue({ status: "timed_out", stdout: "", stderr: "", exitCode: null });
    expect(await probeProviderCli({ provider, executable: "/not-invoked" })).toEqual({
      admitted: false,
      reason: "probe_timed_out",
      exposedTools: [],
    });
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30_000 }));
  },
);

it.each([
  { structured_output: { ok: true }, stop_reason: "tool_use", num_turns: 3 },
  { structured_output: null },
  { num_turns: 2 },
  { stop_reason: "tool_use" },
  { permission_denials: [{ tool_name: "Bash" }] },
  { usage: { server_tool_use: { web_search_requests: 1 } } },
  { usage: { server_tool_use: { unknown_tool: 1 } } },
  { result: '{"ok":false}' },
  { result: 'prefix {"ok":true}' },
])("rejects Claude admission bypass evidence %j", async (override) => {
  vi.spyOn(processHost, "runProcess").mockResolvedValue({
    status: "completed",
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({
      is_error: false,
      result: '{"ok":true}',
      stop_reason: "end_turn",
      num_turns: 1,
      permission_denials: [],
      usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
      ...override,
    }),
  });
  expect(await probeProviderCli({ provider: "claude", executable: "/not-invoked" })).toMatchObject({
    admitted: false,
    reason: "capabilities_exposed",
  });
});

it.each(["quota_exceeded", "authentication_failed"])(
  "preserves native %s as a provider pause while observing failed paid usage",
  async (code) => {
    vi.spyOn(processHost, "runProcess").mockResolvedValue({
      status: "failed",
      exitCode: 1,
      stderr: "",
      stdout: JSON.stringify({ type: "result", is_error: true, error: { code } }),
    });
    const observeUsage = vi.fn(async () => {});
    await expect(
      probeProviderCli({ provider: "claude", executable: "/not-invoked", observeUsage }),
    ).rejects.toMatchObject({
      code: "knowledge_provider_paused",
      reason: code === "quota_exceeded" ? "quota" : "authentication",
    });
    expect(observeUsage).toHaveBeenCalledWith(null);
  },
);

it.each(["json", "normalization"] as const)(
  "checks identity before each %s model call and never publishes a version check as worker selection",
  async (kind) => {
    const process = vi
      .spyOn(processHost, "runProcess")
      .mockResolvedValue({ status: "completed", exitCode: 0, stderr: "", stdout: "2.1.308" });
    const failure = Object.assign(new Error("changed"), { code: "provider_not_admitted" });
    const beforeCall = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    const onCall = vi.fn(async () => {});
    const options = {
      provider: "claude" as const,
      executable: "/installed/claude",
      beforeCall,
      onCall,
      environment: { PATH: "/owner/node/bin:/usr/bin:/bin", HOME: "/owner", SHELL: "/bin/sh" },
    };
    const signal = new AbortController().signal;
    let call: () => Promise<unknown>;
    if (kind === "normalization") {
      const compiler = await createProcessDocumentNormalizationCompiler(options);
      call = () => compiler.normalize({ documents: [] } as never, signal);
    } else {
      const runner = await createNoCapabilityProviderJsonRunner(options);
      call = () => runner.resolve({ responseContract: { schema: { type: "object" } } }, signal);
    }
    expect(onCall).not.toHaveBeenCalled();
    await expect(call()).rejects.toBe(failure);
    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: ["--version"],
        ...providerCliDispatchContext(options.environment),
      }),
    );
    expect(onCall).not.toHaveBeenCalled();
  },
);
