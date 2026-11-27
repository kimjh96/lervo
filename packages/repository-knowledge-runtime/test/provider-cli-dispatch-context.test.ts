import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { noCapabilityJsonInvocationStrategy } from "../src/no-capability-json-strategy.js";
import { tmpdir } from "node:os";
import { dirname, parse, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createNoCapabilityProviderJsonRunner,
  probeProviderCli,
} from "@lervo/repository-knowledge-compiler";
import { identifyProviderCli, providerCliIdentityCurrent } from "../src/provider-cli-identity.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";
import { providerOutputSchema } from "@lervo/schemas";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(["codex", "claude"] as const)(
  "checks and calls a cwd-sensitive %s shim in the same dispatch context",
  async (provider) => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-cwd-dispatch-"));
    roots.push(home);
    const executable = resolve(home, provider);
    const log = resolve(home, "dispatch.jsonl");
    const neutralCwd = parse(tmpdir()).root;
    vi.stubEnv("LERVO_TEST_DISPATCH", "parent-only");
    vi.stubEnv("PATH", "/missing-service-path");
    await writeFile(
      executable,
      `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const context = { cwd: process.cwd(), path: process.env.PATH, marker: process.env.LERVO_TEST_DISPATCH ?? null };
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ ...context, kind: args[0] }) + '\\n');
const expected = context.cwd === ${JSON.stringify(neutralCwd)} && context.marker === null;
if (args[0] === '--version') console.log(expected ? '1.2.3' : '9.9.9');
else if (args[0] === 'debug') console.log(JSON.stringify(expected ? [{type:'message'}] : [{type:'additional_tools',tools:[{name:'exec'}]}]));
else if (${JSON.stringify(provider)} === 'codex') console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({ok:expected})}}));
else {
  const structured = args.includes('--json-schema');
  console.log(JSON.stringify({is_error:false,result:JSON.stringify({ok:expected}),...(structured?{structured_output:{ok:expected}}:{}),stop_reason:structured?'tool_use':'end_turn',num_turns:structured?2:1,permission_denials:[],usage:{server_tool_use:{web_search_requests:0,web_fetch_requests:0}}}));
}
`,
      { mode: 0o700 },
    );
    const environment = { HOME: home, SHELL: "/bin/sh", PATH: "/login-node/bin:/usr/bin:/bin" };
    const identity = (await identifyProviderCli(
      provider,
      executable,
      { home, shell: "/bin/sh", command: runProviderCliCommand },
      environment,
    ))!;
    expect(identity.version).toBe("1.2.3");
    expect(await providerCliIdentityCurrent(identity)).toBe(true);
    expect(
      (
        await probeProviderCli({
          ...identity,
          strategy: noCapabilityJsonInvocationStrategy(identity.provider),
        })
      ).admitted,
    ).toBe(true);
    const beforeCall = vi.fn(async () => {
      expect(await providerCliIdentityCurrent(identity)).toBe(true);
    });
    const runner = await createNoCapabilityProviderJsonRunner({
      ...identity,
      strategy: noCapabilityJsonInvocationStrategy(identity.provider),
      beforeCall,
    });
    expect(
      await runner.resolve({
        responseContract: { schema: providerOutputSchema({ type: "object" }) },
      }),
    ).toEqual({
      ok: true,
    });
    expect(beforeCall).toHaveBeenCalledTimes(2);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls)
      expect(call).toMatchObject({
        cwd: neutralCwd,
        path: `${dirname(executable)}:${environment.PATH}`,
        marker: null,
      });
  },
);
