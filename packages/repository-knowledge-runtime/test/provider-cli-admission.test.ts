import { recordWorkerProviderSelection } from "../src/provider-cli-selection.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";
import {
  detectProviderCliPaths,
  PROVIDER_CLI_LOOKUP,
  defaultProviderCliDetectionPorts,
  identifyProviderCli,
  executableRealPath,
  type ProviderCliDetectionPorts,
} from "../src/provider-cli-detection.js";
import { resolveAdmittedProviderCli } from "../src/provider-cli-admission.js";
import {
  invalidateProviderCliFailures,
  tryInvalidateProviderCliFailures,
} from "../src/provider-cli-invalidation.js";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import { providerCliFindings, readProviderCliProjection } from "../src/provider-cli-findings.js";

const roots: string[] = [];
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-cli-admission-"));
  roots.push(home);
  const shell = process.execPath;
  const codex = resolve(home, "shell/codex");
  const claude = resolve(home, ".local/bin/claude");
  for (const path of [codex, claude]) {
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, "original", { mode: 0o700 });
  }
  const events = new Map<string, unknown>();
  const storage = {
    paths: { repositoryRoot: home },
    manifest: { projectId: "prj_provider_cli_test" },
    writableEventSchemaVersion: 4,
    events: {
      get: (id: string) => events.get(id) ?? null,
      append: (event: { eventId: string }) => {
        events.set(event.eventId, event);
      },
    },
  } as unknown as ProjectStorage;
  const command = vi.fn<ProviderCliDetectionPorts["command"]>(async (_exe, args) =>
    args[0] === "--version"
      ? {
          status: "completed",
          stdout: _exe.includes("claude") ? "2.1.308 (Claude Code)" : "codex-cli 0.166.0",
        }
      : {
          status: "completed",
          stdout:
            args[1] === PROVIDER_CLI_LOOKUP
              ? `\0/usr/bin:/bin\0${codex}\nclaude='claude --dangerously-skip-permissions'\n`
              : "",
        },
  );
  const ports: ProviderCliDetectionPorts = { home, shell, command, prefixes: [] };
  const probe = vi.fn(async (identity: { provider: string }) =>
    identity.provider === "codex"
      ? {
          admitted: false as const,
          reason: "capabilities_exposed" as const,
          exposedTools: ["exec", "spawn_agent"],
        }
      : { admitted: true as const, probeResultHash: sha256("no tools") },
  );
  const input = {
    storage,
    preferred: "codex" as const,
    allowed: ["codex", "claude"] as const,
    directory: resolve(home, "cache"),
    ports,
    probe,
    now: new Date("2026-10-31T00:00:00Z"),
  };
  return { home, codex, claude, events, input, ports, probe };
}

it("finds the login executable and Claude native location while rejecting aliases, relative paths and nonexecutables", async () => {
  const f = await fixture();
  const result = await detectProviderCliPaths(f.ports);
  expect(result.paths.codex).toContain(f.codex);
  expect(result.paths.claude).toContain(f.claude);
  expect(result.paths.claude.join()).not.toContain("dangerously");
  expect(f.ports.command).toHaveBeenCalledWith(
    process.execPath,
    ["-lc", PROVIDER_CLI_LOOKUP, "lervo-provider-lookup", "codex", "claude"],
    3000,
    expect.objectContaining({ HOME: f.home, SHELL: process.execPath }),
  );
  expect(await executableRealPath("claude")).toBeNull();
  expect(await executableRealPath(f.home)).toBeNull();
  await chmod(f.codex, 0o600);
  expect(await executableRealPath(f.codex)).toBeNull();
});

it.each(["failed", "timed_out"] as const)(
  "reports shell %s and continues only with well-known locations",
  async (status) => {
    const f = await fixture();
    f.ports.command = async () => ({ status, stdout: f.codex });
    const result = await detectProviderCliPaths(f.ports);
    expect(result.failure).toBe(
      status === "timed_out" ? "login_shell_timed_out" : "login_shell_failed",
    );
    expect(result.paths.codex).not.toContain(f.codex);
    expect(result.paths.claude).toContain(f.claude);
  },
);

it("falls back from rejected Codex to admitted Claude without weakening the contract", async () => {
  const f = await fixture();
  const result = await resolveAdmittedProviderCli(f.input);
  expect(result.selected).toMatchObject({
    provider: "claude",
    executable: f.claude,
    version: "2.1.308",
  });
  expect(result.projection.providers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: "codex",
        admitted: false,
        exposedTools: ["exec", "spawn_agent"],
      }),
      expect.objectContaining({ provider: "claude", admitted: true }),
    ]),
  );
  const events = JSON.stringify([...f.events.values()]);
  expect(events).toContain("provider.cli.rejected");
  expect(events).toContain("provider.cli.admitted");
  expect(events).not.toContain(f.home);
  expect(events).not.toContain("dangerously");
  expect((await stat(resolve(f.home, "cache/current.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(resolve(f.home, "cache"))).mode & 0o777).toBe(0o700);
});

it("reuses admission only for the exact real path, version and content, including retargeted links", async () => {
  const f = await fixture();
  await resolveAdmittedProviderCli(f.input);
  expect(f.probe).toHaveBeenCalledTimes(2);
  await resolveAdmittedProviderCli(f.input);
  expect(f.probe).toHaveBeenCalledTimes(2);
  await writeFile(f.claude, "updated bytes");
  await resolveAdmittedProviderCli(f.input);
  expect(f.probe).toHaveBeenCalledTimes(3);
  const replacement = resolve(f.home, "new-claude");
  await writeFile(replacement, "another executable", { mode: 0o700 });
  await unlink(f.claude);
  await symlink(replacement, f.claude);
  await resolveAdmittedProviderCli(f.input);
  expect(f.probe).toHaveBeenCalledTimes(4);
  await writeFile(f.codex, "new codex version");
  await writeFile(replacement, "new claude version");
  f.ports.command = async (_exe, args) =>
    args[0] === "--version"
      ? { status: "completed", stdout: "3.0.0" }
      : { status: "completed", stdout: "" };
  await resolveAdmittedProviderCli(f.input);
  expect(f.probe).toHaveBeenCalledTimes(6);
});

it("reports provider_not_admitted until an admitted allowed executable appears", async () => {
  const f = await fixture();
  await rm(f.claude);
  const missing = await resolveAdmittedProviderCli(f.input);
  expect(missing.selected).toBeNull();
  expect(providerCliFindings(missing.projection)).toContainEqual(
    expect.objectContaining({ code: "provider_not_admitted", actor: "provider admission" }),
  );
  await writeFile(f.claude, "installed later", { mode: 0o700 });
  const available = await resolveAdmittedProviderCli(f.input);
  expect(available.selected?.provider).toBe("claude");
  expect(available.projection.waiting).toBe(false);
  expect(providerCliFindings(available.projection).map((finding) => finding.code)).not.toContain(
    "provider_not_admitted",
  );
});

it("never selects a provider outside delegation scope and honors optional executable overrides", async () => {
  const f = await fixture();
  const onlyCodex = await resolveAdmittedProviderCli({ ...f.input, allowed: ["codex"] });
  expect(onlyCodex.selected).toBeNull();
  await mkdir(resolve(f.home, ".lervo"), { recursive: true });
  const override = resolve(f.home, "custom-claude");
  await writeFile(override, "owner executable", { mode: 0o700 });
  await writeFile(
    resolve(f.home, ".lervo/provider-clis.json"),
    JSON.stringify({ schemaVersion: 1, executables: { claude: override } }),
  );
  const selected = await resolveAdmittedProviderCli(f.input);
  expect(selected.selected?.executable).toBe(override);
});

it("exposes detection, admission, rejection and waiting through continuity and agent-owned attention", async () => {
  const f = await fixture();
  const { projection } = await resolveAdmittedProviderCli(f.input);
  const state = await readProviderCliProjection(f.home);
  expect(state).toEqual(projection);
  const findings = providerCliFindings(state);
  expect(findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining([
      "provider_cli_detected",
      "provider_cli_admitted",
      "provider_cli_rejected",
    ]),
  );
  expect(findings.every((finding) => finding.actor === "provider admission")).toBe(true);
  expect(
    await readFile(resolve(f.home, ".lervo/state/knowledge/provider-clis.json"), "utf8"),
  ).not.toContain(f.home);
});

it("discovers npm global and the nvm default with the same algorithm on either host", async () => {
  const f = await fixture();
  const prefix = resolve(f.home, "npm-global");
  await mkdir(resolve(f.home, ".nvm/alias"), { recursive: true });
  await mkdir(resolve(f.home, ".nvm/versions/node/v24.1.0/bin"), { recursive: true });
  await writeFile(resolve(f.home, ".nvm/alias/default"), "v24.1.0\n");
  await writeFile(resolve(f.home, ".npmrc"), `prefix=${prefix}\n`);
  const paths = (await detectProviderCliPaths(f.ports)).paths;
  expect(paths.codex).toContain(resolve(prefix, "bin/codex"));
  expect(paths.claude).toContain(resolve(f.home, ".nvm/versions/node/v24.1.0/bin/claude"));
});

it("does not admit an identity that changes while probing and retries transient rejections on schedule", async () => {
  const f = await fixture();
  const probe = vi.fn(async (identity: { provider: string }) => {
    if (identity.provider === "claude") await writeFile(f.claude, "changed while probing");
    return { admitted: true as const, probeResultHash: sha256("passed") };
  });
  const result = await resolveAdmittedProviderCli({ ...f.input, allowed: ["claude"], probe });
  expect(result.selected).toBeNull();
  expect(result.projection.providers).toContainEqual(
    expect.objectContaining({ provider: "claude", reason: "identity_changed" }),
  );
  const failed = vi.fn(async () => ({
    admitted: false as const,
    reason: "probe_timed_out" as const,
    exposedTools: [],
  }));
  await resolveAdmittedProviderCli({ ...f.input, allowed: ["codex"], probe: failed });
  const before = failed.mock.calls.length;
  await resolveAdmittedProviderCli({ ...f.input, allowed: ["codex"], probe: failed });
  expect(failed).toHaveBeenCalledTimes(before);
  await resolveAdmittedProviderCli({
    ...f.input,
    allowed: ["codex"],
    probe: failed,
    now: new Date(f.input.now.getTime() + 60_001),
  });
  expect(failed).toHaveBeenCalledTimes(before + 1);
});

it("publishes detected providers without model probes when continuity only observes cached admission", async () => {
  const f = await fixture();
  const observed = await resolveAdmittedProviderCli({ ...f.input, admissionMode: "cached" });
  expect(f.probe).not.toHaveBeenCalled();
  expect(observed.projection.providers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provider: "codex", admitted: false, reason: null }),
      expect.objectContaining({ provider: "claude", admitted: false, reason: null }),
    ]),
  );
  const admitted = await resolveAdmittedProviderCli(f.input);
  const replayed = await resolveAdmittedProviderCli({ ...f.input, admissionMode: "cached" });
  expect(replayed.projection.providers).toEqual(admitted.projection.providers);
  expect(f.probe).toHaveBeenCalledTimes(2);
});

it("removes aliases and functions before finding the real installed executable", async () => {
  const f = await fixture();
  const shell = resolve(f.home, "login-shell");
  const marker = resolve(f.home, "alias-executed");
  // POSIX-mode bash (macOS /bin/sh) would expand an earlier alias inside `codex()`.
  await writeFile(
    shell,
    `#!/bin/sh
codex() { touch "${marker}"; }
alias codex='touch "${marker}"'
PATH="${resolve(f.codex, "..")}:/usr/bin:/bin"
export PATH
script=$2
shift 3
eval "$script"
`,
    { mode: 0o700 },
  );
  const result = await detectProviderCliPaths({
    ...f.ports,
    shell,
    command: runProviderCliCommand,
  });
  expect(result.paths.codex[0]).toBe(f.codex);
  expect(result.environment.PATH).toBe(`${resolve(f.codex, "..")}:/usr/bin:/bin`);
  await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([".volta/bin", ".asdf/shims", ".local/share/mise/shims"])(
  "finds %s shims after shell failure and preserves the invocation name",
  async (directory) => {
    const f = await fixture();
    const bin = resolve(f.home, directory);
    await mkdir(bin, { recursive: true });
    const dispatcher = resolve(f.home, "dispatcher");
    await writeFile(
      dispatcher,
      '#!/bin/sh\ncase "$0" in */codex) echo 1.2.3;; *) exit 1;; esac\n',
      { mode: 0o700 },
    );
    const shim = resolve(bin, "codex");
    await symlink(dispatcher, shim);
    const ports = { ...f.ports, shell: "/missing-shell", command: runProviderCliCommand };
    const detection = await detectProviderCliPaths(ports);
    expect(detection.failure).toBe("login_shell_failed");
    expect(detection.paths.codex).toContain(shim);
    const identity = await identifyProviderCli("codex", shim, ports, detection.environment);
    expect(identity).toMatchObject({
      executable: shim,
      realPath: await realpath(dispatcher),
      version: "1.2.3",
    });
  },
);

it("uses the account home and shell when HOME and SHELL are absent or empty", async () => {
  for (const value of [undefined, ""]) {
    vi.stubEnv("HOME", value);
    vi.stubEnv("SHELL", value);
    const ports = defaultProviderCliDetectionPorts();
    expect(ports.home.startsWith("/")).toBe(true);
    expect(ports.shell.startsWith("/")).toBe(true);
  }
  vi.unstubAllEnvs();
});

it("never probes a later candidate after the preferred provider is admitted", async () => {
  const f = await fixture();
  const probe = vi.fn(async () => ({ admitted: true as const, probeResultHash: sha256("passed") }));
  const result = await resolveAdmittedProviderCli({ ...f.input, probe });
  expect(result.selected?.provider).toBe("codex");
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex" }));
  expect(result.projection.selected).toBeNull();
});

it.each(["later_candidate", "outside_delegation"])(
  "caches unprobed native detection identities for %s",
  async (reason) => {
    const f = await fixture();
    for (const path of [f.codex, f.claude])
      await writeFile(path, Buffer.from("7f454c4601020304", "hex"));
    const probe = vi.fn(async () => ({
      admitted: true as const,
      probeResultHash: sha256("passed"),
    }));
    const input = {
      ...f.input,
      probe,
      allowed: reason === "outside_delegation" ? (["codex"] as const) : f.input.allowed,
    };
    await resolveAdmittedProviderCli(input);
    expect(probe).toHaveBeenCalledTimes(1);
    const cache = JSON.parse(await readFile(resolve(f.home, "cache/current.json"), "utf8"));
    expect(cache.identities).toHaveLength(2);
    expect(cache.entries).toHaveLength(1);
    const versions = vi
      .mocked(f.ports.command)
      .mock.calls.filter((call) => call[1][0] === "--version").length;
    const hashes = vi.mocked(createReadStream).mock.calls.length;
    await resolveAdmittedProviderCli(input);
    await resolveAdmittedProviderCli({ ...input, admissionMode: "cached" });
    expect(createReadStream).toHaveBeenCalledTimes(hashes);
    expect(
      vi.mocked(f.ports.command).mock.calls.filter((call) => call[1][0] === "--version"),
    ).toHaveLength(versions);
    const fallback = await resolveAdmittedProviderCli({
      ...input,
      preferred: "claude",
      allowed: f.input.allowed,
    });
    expect(fallback.selected?.provider).toBe("claude");
    expect(probe).toHaveBeenCalledTimes(2);
    expect(createReadStream).toHaveBeenCalledTimes(hashes);
    await writeFile(f.claude, Buffer.from("7f454c460102030405", "hex"));
    await resolveAdmittedProviderCli({ ...input, preferred: "claude", allowed: f.input.allowed });
    expect(probe).toHaveBeenCalledTimes(3);
    expect(createReadStream).toHaveBeenCalledTimes(hashes + 1);
  },
);

it("skips paused cached admissions and retains them for explicit recovery", async () => {
  const f = await fixture();
  const probe = vi.fn(async () => ({ admitted: true as const, probeResultHash: sha256("passed") }));
  const input = { ...f.input, preferred: "claude" as const, probe };
  expect((await resolveAdmittedProviderCli(input)).selected?.provider).toBe("claude");
  const paused = await resolveAdmittedProviderCli({
    ...input,
    providerPaused: async (provider) => provider === "claude",
  });
  expect(paused.selected?.provider).toBe("codex");
  expect(probe).toHaveBeenCalledTimes(2);
  expect((await resolveAdmittedProviderCli(input)).selected?.provider).toBe("claude");
  expect(probe).toHaveBeenCalledTimes(2);
});

it("reuses unprobed script detection until the candidate is evaluated for use", async () => {
  const f = await fixture();
  const probe = vi.fn(async () => ({ admitted: true as const, probeResultHash: sha256("passed") }));
  const input = { ...f.input, probe };
  await resolveAdmittedProviderCli(input);
  const claudeVersions = () =>
    vi
      .mocked(f.ports.command)
      .mock.calls.filter(([path, args]) => path === f.claude && args[0] === "--version").length;
  expect(claudeVersions()).toBe(1);
  const hashes = vi.mocked(createReadStream).mock.calls.length;
  await resolveAdmittedProviderCli(input);
  await resolveAdmittedProviderCli({ ...input, admissionMode: "cached" });
  expect(claudeVersions()).toBe(1);
  expect(createReadStream).toHaveBeenCalledTimes(hashes);
  const command = f.ports.command;
  f.ports.command = (path, args, timeout, environment) =>
    path === f.claude && args[0] === "--version"
      ? Promise.resolve({ status: "completed", stdout: "claude 3.0.0" })
      : command(path, args, timeout, environment);
  const selected = await resolveAdmittedProviderCli({ ...input, preferred: "claude" });
  expect(selected.selected?.version).toBe("3.0.0");
  expect(probe).toHaveBeenCalledTimes(2);
  expect(probe).toHaveBeenLastCalledWith(
    expect.objectContaining({ provider: "claude", version: "3.0.0" }),
  );
  expect(createReadStream).toHaveBeenCalledTimes(hashes);
});

it.each([
  "knowledge_authority_unavailable",
  "normalization_budget_exceeded",
  "knowledge_capacity_unavailable",
])("preserves the resolution failure scope for %s", async (code) => {
  const f = await fixture();
  const probe = vi.fn(async () => {
    throw Object.assign(new Error("unavailable"), { code });
  });
  await expect(
    resolveAdmittedProviderCli({ ...f.input, preferred: "claude", probe }),
  ).rejects.toMatchObject({ code });
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledWith(expect.objectContaining({ provider: "claude" }));
});

it("serializes concurrent probes while cached-only observers cannot overwrite new results", async () => {
  const f = await fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const probe = vi.fn(async () => {
    started();
    await blocked;
    return { admitted: true as const, probeResultHash: sha256("passed") };
  });
  const first = resolveAdmittedProviderCli({ ...f.input, probe });
  await ready;
  const observer = await resolveAdmittedProviderCli({ ...f.input, admissionMode: "cached" });
  expect(observer.selected).toBeNull();
  await expect(stat(resolve(f.home, "cache/current.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const second = resolveAdmittedProviderCli({ ...f.input, probe });
  release();
  expect((await first).selected?.provider).toBe("codex");
  expect((await second).selected?.provider).toBe("codex");
  expect(probe).toHaveBeenCalledTimes(1);
  const bytes = await readFile(resolve(f.home, "cache/current.json"), "utf8");
  const projection = await readFile(
    resolve(f.home, ".lervo/state/knowledge/provider-clis.json"),
    "utf8",
  );
  const events = f.events.size;
  await resolveAdmittedProviderCli({
    ...f.input,
    admissionMode: "cached",
    now: new Date(f.input.now.getTime() + 120_000),
  });
  expect(await readFile(resolve(f.home, "cache/current.json"), "utf8")).toBe(bytes);
  expect(await readFile(resolve(f.home, ".lervo/state/knowledge/provider-clis.json"), "utf8")).toBe(
    projection,
  );
  expect(f.events.size).toBe(events);
});

it("backs off repeated transient failures exponentially to a one-hour cap", async () => {
  const f = await fixture();
  const probe = vi.fn(async () => ({
    admitted: false as const,
    reason: "probe_failed" as const,
    exposedTools: [],
  }));
  let elapsed = 0;
  const run = (milliseconds: number) =>
    resolveAdmittedProviderCli({
      ...f.input,
      allowed: ["codex"],
      probe,
      now: new Date(f.input.now.getTime() + milliseconds),
    });
  await run(0);
  for (const delay of [
    60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000,
  ]) {
    const count = probe.mock.calls.length;
    await run(elapsed + delay - 1);
    expect(probe).toHaveBeenCalledTimes(count);
    elapsed += delay;
    await run(elapsed);
    expect(probe).toHaveBeenCalledTimes(count + 1);
  }
});

it("projects the worker observation separately when preferred and delegation orders differ", async () => {
  const f = await fixture();
  const first = await resolveAdmittedProviderCli(f.input);
  await recordWorkerProviderSelection(f.home, first.selected!);
  await writeFile(f.codex, "now admitted codex");
  const probe = vi.fn(async () => ({ admitted: true as const, probeResultHash: sha256("passed") }));
  const current = await resolveAdmittedProviderCli({
    ...f.input,
    allowed: ["claude", "codex"],
    preferred: "codex",
    probe,
  });
  expect(current.selected?.provider).toBe("codex");
  expect(current.projection.providers).toContainEqual(
    expect.objectContaining({ provider: "codex", admitted: true }),
  );
  expect(current.projection.selected).toEqual({ provider: "claude", version: "2.1.308" });
  const observed = await resolveAdmittedProviderCli({
    ...f.input,
    preferred: "claude",
    allowed: ["codex", "claude"],
    admissionMode: "cached",
  });
  expect(observed.projection.selected).toEqual({ provider: "claude", version: "2.1.308" });
});

it("forgets a provider's recorded failures after an explicit probe, host-wide and per repository", async () => {
  const f = await fixture();
  // Claude was logged out: its probe failed, and this repository's record says none is admitted.
  const failing = vi.fn(async () => ({
    admitted: false as const,
    reason: "probe_failed" as const,
    exposedTools: [],
  }));
  await resolveAdmittedProviderCli({ ...f.input, allowed: ["claude"], probe: failing });
  const projectionPath = resolve(f.home, ".lervo/state/knowledge/provider-clis.json");
  expect(JSON.parse(await readFile(projectionPath, "utf8"))).toMatchObject({ waiting: true });
  // Another repository on the host whose record shows Claude admitted keeps it.
  const other = await mkdtemp(resolve(tmpdir(), "lervo-cli-admission-other-"));
  roots.push(other);
  await mkdir(resolve(other, ".lervo/state/knowledge"), { recursive: true });
  const kept = JSON.parse(await readFile(projectionPath, "utf8")) as {
    providers: { admitted: boolean; reason: string | null }[];
  };
  kept.providers = kept.providers.map((cli) => ({ ...cli, admitted: true, reason: null }));
  await writeFile(
    resolve(other, ".lervo/state/knowledge/provider-clis.json"),
    JSON.stringify(kept),
  );

  expect(
    await invalidateProviderCliFailures({
      provider: "claude",
      repositoryRoots: [f.home, other],
      directory: f.input.directory,
    }),
  ).toEqual({ hostCacheEntries: 1, repositoryProjections: 1 });
  await expect(stat(projectionPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    stat(resolve(other, ".lervo/state/knowledge/provider-clis.json")),
  ).resolves.toBeDefined();
  // A minute later, inside the failure's backoff, the next admission probes Claude again once.
  const passing = vi.fn(async () => ({ admitted: true as const, probeResultHash: sha256("ok") }));
  const later = new Date(f.input.now.getTime() + 60_000);
  const admitted = await resolveAdmittedProviderCli({
    ...f.input,
    allowed: ["claude"],
    probe: passing,
    now: later,
  });
  expect(passing).toHaveBeenCalledTimes(1);
  expect(admitted.selected?.provider).toBe("claude");
  // Every other repository then reuses that one host result instead of probing again.
  await resolveAdmittedProviderCli({ ...f.input, allowed: ["claude"], probe: passing, now: later });
  expect(passing).toHaveBeenCalledTimes(1);
});

it("keeps the hourly backoff when the provider fails again after an explicit probe", async () => {
  const f = await fixture();
  const failing = vi.fn(async () => ({
    admitted: false as const,
    reason: "probe_failed" as const,
    exposedTools: [],
  }));
  const at = (minutes: number) => new Date(f.input.now.getTime() + minutes * 60_000);
  const run = (minutes: number) =>
    resolveAdmittedProviderCli({
      ...f.input,
      allowed: ["claude"],
      probe: failing,
      now: at(minutes),
    });
  // Seven failures climb the backoff to its one-hour cap: 1, 2, 4, 8, 16, 32, then 60 minutes.
  let minutes = 0;
  await run(minutes);
  for (const delay of [1, 2, 4, 8, 16, 32]) await run((minutes += delay));
  expect(failing).toHaveBeenCalledTimes(7);
  await invalidateProviderCliFailures({
    provider: "claude",
    repositoryRoots: [f.home],
    directory: f.input.directory,
  });
  // The invalidated entry is probed at once; failing again keeps it an hour away, not a minute.
  await run((minutes += 1));
  expect(failing).toHaveBeenCalledTimes(8);
  await run(minutes + 2);
  await run(minutes + 59);
  expect(failing).toHaveBeenCalledTimes(8);
  await run(minutes + 60);
  expect(failing).toHaveBeenCalledTimes(9);
});

it("waits briefly for an admission holding the host cache lock, then reports instead of failing", async () => {
  const f = await fixture();
  await resolveAdmittedProviderCli(f.input);
  // Another process's admission holds the host cache lock; this process is alive, so it counts.
  const lock = openSqliteDatabase(resolve(f.input.directory, "cache-lock.sqlite"), {
    busyTimeoutMs: 1000,
  });
  const hold = () =>
    lock
      .prepare("INSERT OR REPLACE INTO holder(id,pid,nonce) VALUES(1,?,?)")
      .run(process.ppid, "x");
  hold();
  const input = {
    provider: "claude" as const,
    repositoryRoots: [f.home],
    directory: f.input.directory,
  };
  try {
    await expect(tryInvalidateProviderCliFailures(input, [5, 5])).resolves.toEqual({
      invalidated: null,
      reason: "knowledge_capacity_unavailable",
    });
    // A holder that finishes within the bound lets the cleanup run.
    setTimeout(() => lock.prepare("DELETE FROM holder WHERE id=1").run(), 20);
    await expect(tryInvalidateProviderCliFailures(input, [200])).resolves.toMatchObject({
      invalidated: { hostCacheEntries: 0 },
      reason: null,
    });
  } finally {
    lock.close();
  }
});
