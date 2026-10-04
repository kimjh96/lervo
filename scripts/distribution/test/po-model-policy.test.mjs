import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import policy from "../po-model-policy.json" with { type: "json" };
import { reconcilePoModelPolicy } from "../po-model-policy.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function configuration() {
  return {
    remoteCommands: {
      providerHost: {
        models: { codex: "gpt-6-astra", claude: "claude-opus-5" },
        executionProfiles: {
          routine: {
            preferredProvider: "claude",
            providers: {
              codex: { model: "gpt-5.6-terra", reasoningEffort: "medium" },
              claude: { model: "claude-sonnet-4-6", reasoningEffort: "medium" },
            },
          },
          reasoning: {
            preferredProvider: "codex",
            providers: {
              codex: { model: "gpt-6-astra", reasoningEffort: "high", timeoutMs: 180_000 },
              claude: { model: "claude-opus-5", reasoningEffort: "high", timeoutMs: 180_000 },
            },
          },
          review: {
            preferredProvider: "claude",
            providers: {
              codex: { model: "gpt-6-astra", reasoningEffort: "high", timeoutMs: 180_000 },
              claude: { model: "claude-opus-5", reasoningEffort: "high", timeoutMs: 180_000 },
            },
          },
        },
      },
    },
    outcomeSupervision: { ownerReasoning: { provider: "codex", model: "gpt-6-astra" } },
    discordConversation: {
      agentParticipantId: "ptc_shifloruen01",
      botTokenFile: "/owner-only/token",
      displayLabel: "gpt-6-astra",
      routing: {
        response: { provider: "claude", model: "claude-opus-5-5", timeoutMs: 45_000 },
        resultEvaluation: { provider: "claude", model: "claude-opus-5", reasoningEffort: "high" },
      },
      deliberationParticipation: {
        routes: [{ provider: "codex", model: "gpt-6-astra", reasoningEffort: "high" }],
      },
    },
  };
}

it("reconciles the named PO, native profiles, and opposite-provider review", () => {
  const original = configuration();
  const result = reconcilePoModelPolicy(original, policy);
  expect(original.remoteCommands.providerHost.models.codex).toBe("gpt-6-astra");
  expect(result.remoteCommands.providerHost.models.codex).toBe("gpt-6-sol");
  expect(result.remoteCommands.providerHost.executionProfiles.routine.providers).toMatchObject({
    codex: { model: "gpt-6-sol", reasoningEffort: "medium" },
    claude: { model: "claude-opus-5-5", reasoningEffort: "medium" },
  });
  expect(result.remoteCommands.providerHost.executionProfiles.routine.preferredProvider).toBe(
    "codex",
  );
  expect(result.remoteCommands.providerHost.executionProfiles.reasoning.providers.codex).toEqual({
    model: "gpt-6-sol",
    reasoningEffort: "high",
    timeoutMs: 180_000,
  });
  expect(result.outcomeSupervision.ownerReasoning.model).toBe("gpt-6-sol");
  expect(result.discordConversation.deliberationParticipation.routes[0].model).toBe("gpt-6-sol");
  expect(result.discordConversation.routing.response).toMatchObject({
    provider: "codex",
    model: "gpt-6-sol",
    reasoningEffort: "medium",
    timeoutMs: 45_000,
  });
  expect(result.discordConversation.routing.resultEvaluation).toEqual({
    provider: "claude",
    model: "claude-opus-5-5",
    reasoningEffort: "high",
  });
  expect(result.discordConversation.botTokenFile).toBe("/owner-only/token");
  expect(result.discordConversation.displayLabel).toBe("gpt-6-astra");
  expect(reconcilePoModelPolicy(result, policy)).toEqual(result);
});

it("does not reassign a hired participant's conversation route", () => {
  const original = configuration();
  original.discordConversation.agentParticipantId = "ptc_agent_cd8a9ebda2be92e898cf63ac";
  original.discordConversation.routing.response = {
    provider: "codex",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
  };
  const result = reconcilePoModelPolicy(original, policy);
  expect(result.discordConversation.routing).toEqual(original.discordConversation.routing);
});

it("keeps the eight named responses at three Opus and five Sol with opposite reviewers", () => {
  expect(Object.keys(policy.conversationRoutes)).toHaveLength(8);
  expect(
    Object.values(policy.conversationRoutes).filter((route) => route.provider === "claude"),
  ).toHaveLength(3);
  for (const [participantId, route] of Object.entries(policy.conversationRoutes)) {
    const original = configuration();
    original.discordConversation.agentParticipantId = participantId;
    const result = reconcilePoModelPolicy(original, policy);
    expect(result.discordConversation.routing.response).toMatchObject({
      ...route,
      reasoningEffort: "medium",
      timeoutMs: 45_000,
    });
    expect(result.discordConversation.routing.resultEvaluation).toMatchObject({
      provider: route.provider === "codex" ? "claude" : "codex",
      reasoningEffort: "high",
    });
  }
});

it("rejects a shared backup directory before changing a configuration", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-po-model-policy-"));
  roots.push(root);
  const config = resolve(root, "node.json");
  const backupDir = resolve(root, "shared-backups");
  const original = `${JSON.stringify(configuration(), null, 2)}\n`;
  await writeFile(config, original, { mode: 0o600 });
  await mkdir(backupDir, { mode: 0o755 });
  await chmod(backupDir, 0o755);
  const script = resolve(import.meta.dirname, "../reconcile-po-model-configs.mjs");
  const attempt = spawnSync(
    process.execPath,
    [script, "--config", config, "--backup-dir", backupDir, "--apply"],
    { encoding: "utf8" },
  );
  expect(attempt.status).not.toBe(0);
  expect(attempt.stderr).toContain("Backup directory must be private to its owner.");
  expect(await readFile(config, "utf8")).toBe(original);
});

it("fails closed when a deployment lacks a provider route", () => {
  const original = configuration();
  delete original.remoteCommands.providerHost.executionProfiles.review.providers.claude;
  expect(() => reconcilePoModelPolicy(original, policy)).toThrow("Installed review.claude route");
});

it("dry-runs before applying an owner-only, recoverable configuration update", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-po-model-policy-"));
  roots.push(root);
  const config = resolve(root, "node.json");
  const backupDir = resolve(root, "backups");
  const original = `${JSON.stringify(configuration(), null, 2)}\n`;
  await writeFile(config, original, { mode: 0o600 });
  const script = resolve(import.meta.dirname, "../reconcile-po-model-configs.mjs");
  const dryRun = JSON.parse(
    execFileSync(process.execPath, [script, "--config", config], { encoding: "utf8" }),
  );
  expect(dryRun).toMatchObject({ applied: false, configurations: [{ changed: true }] });
  expect(await readFile(config, "utf8")).toBe(original);
  const applied = JSON.parse(
    execFileSync(
      process.execPath,
      [script, "--config", config, "--backup-dir", backupDir, "--apply"],
      { encoding: "utf8" },
    ),
  );
  expect(applied).toMatchObject({ applied: true, configurations: [{ changed: true }] });
  expect((await stat(config)).mode & 0o777).toBe(0o600);
  expect(
    await readFile(
      resolve(backupDir, `node.json.${applied.configurations[0].beforeHash.slice(7, 19)}.bak`),
      "utf8",
    ),
  ).toBe(original);
});
