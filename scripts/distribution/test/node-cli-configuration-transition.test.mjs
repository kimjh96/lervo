import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createNodeCliConfigurationTransition } from "../lib/node-cli-configuration-transition.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))),
);
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-binding-"));
  roots.push(root);
  const config = resolve(root, "node.json");
  const configurationSource = resolve(root, "candidate.json");
  const executable = resolve(root, "new-cli");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const before = {
    repositoryRoot: root,
    discordConversation: { deliberation: { cliExecutable: resolve(root, "old-cli") } },
    outcomeSupervision: {
      owner: "preserved",
      managedExecution: { cliBundle: resolve(root, "old-cli") },
    },
  };
  const after = structuredClone(before);
  after.discordConversation.deliberation.cliExecutable = executable;
  await writeFile(config, JSON.stringify(before), { mode: 0o600 });
  await writeFile(configurationSource, JSON.stringify(after), { mode: 0o600 });
  let current = hash(await readFile(config));
  const admission = {
    replaceConfiguration: (expected, desired) => {
      if (expected !== current) return false;
      current = desired;
      return true;
    },
  };
  return { root, config, configurationSource, before, after, admission, current: () => current };
}

it("keeps exact original bytes, applies only CLI references, and restores both bytes and frozen binding", async () => {
  const f = await fixture();
  const original = await readFile(f.config);
  const transition = await createNodeCliConfigurationTransition(f, f.admission);
  expect(await readFile(f.config)).toEqual(original);
  await transition.apply();
  expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(f.after);
  expect(f.current()).toBe(hash(await readFile(f.config)));
  await transition.restore();
  expect(await readFile(f.config)).toEqual(original);
  expect(f.current()).toBe(hash(original));
  expect(JSON.parse(await readFile(`${f.config}.cli-transition.json`, "utf8")).state).toBe(
    "restored",
  );
});

it.each(["managed", "both"])(
  "replaces exact %s CLI references and restores the predecessor",
  async (binding) => {
    const f = await fixture();
    const after = structuredClone(f.before);
    const executable = f.after.discordConversation.deliberation.cliExecutable;
    after.outcomeSupervision.managedExecution.cliBundle = executable;
    if (binding === "both") after.discordConversation.deliberation.cliExecutable = executable;
    await writeFile(f.configurationSource, JSON.stringify(after), { mode: 0o600 });
    const original = await readFile(f.config);
    const transition = await createNodeCliConfigurationTransition(f, f.admission);
    await transition.apply();
    expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(after);
    expect(f.current()).toBe(hash(await readFile(f.config)));
    await transition.restore();
    expect(await readFile(f.config)).toEqual(original);
    expect(f.current()).toBe(hash(original));
  },
);

it("rejects an unrelated managed execution change with a CLI reference", async () => {
  const f = await fixture();
  const after = structuredClone(f.before);
  after.outcomeSupervision.managedExecution.cliBundle =
    f.after.discordConversation.deliberation.cliExecutable;
  after.outcomeSupervision.managedExecution.nodeExecutable = resolve(f.root, "new-node");
  await writeFile(f.configurationSource, JSON.stringify(after), { mode: 0o600 });
  await expect(createNodeCliConfigurationTransition(f, f.admission)).rejects.toMatchObject({
    code: "service_upgrade_unknown",
  });
  expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(f.before);
});

it("rejects new repository or supervision authority before configuration effects", async () => {
  const f = await fixture();
  await writeFile(
    f.configurationSource,
    JSON.stringify({ ...f.after, outcomeSupervision: { owner: "changed" } }),
  );
  await expect(createNodeCliConfigurationTransition(f, f.admission)).rejects.toMatchObject({
    code: "service_upgrade_unknown",
  });
  expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(f.before);
});

it("adds one already shared Discord channel and restores its exact predecessor", async () => {
  const f = await fixture();
  const shared = { tenantKey: "guild", conversationKey: "channel", conversationId: "shared" };
  const before = {
    repositoryRoot: f.root,
    discordConversations: [
      {
        allowedGuildIds: ["guild"],
        conversations: [],
        deliberation: { cliExecutable: resolve(f.root, "old-cli") },
      },
      {
        allowedGuildIds: ["guild"],
        conversations: [shared],
        deliberation: { cliExecutable: resolve(f.root, "old-cli") },
      },
    ],
  };
  const after = structuredClone(before);
  after.discordConversations[0].conversations.push(shared);
  await writeFile(f.config, JSON.stringify(before), { mode: 0o600 });
  await writeFile(f.configurationSource, JSON.stringify(after), { mode: 0o600 });
  const original = await readFile(f.config);
  const transition = await createNodeCliConfigurationTransition(f, {
    replaceConfiguration: () => true,
  });
  await transition.apply();
  expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(after);
  await transition.restore();
  expect(await readFile(f.config)).toEqual(original);
});

it("rejects a novel channel or a simultaneous CLI authority change", async () => {
  const f = await fixture();
  const shared = { tenantKey: "guild", conversationKey: "channel", conversationId: "shared" };
  const before = {
    repositoryRoot: f.root,
    discordConversations: [
      {
        allowedGuildIds: ["guild"],
        conversations: [],
        deliberation: { cliExecutable: resolve(f.root, "old-cli") },
      },
      {
        allowedGuildIds: ["guild"],
        conversations: [shared],
        deliberation: { cliExecutable: resolve(f.root, "old-cli") },
      },
    ],
  };
  const after = structuredClone(before);
  after.discordConversations[0].conversations.push({ ...shared, conversationKey: "other" });
  await writeFile(f.config, JSON.stringify(before), { mode: 0o600 });
  await writeFile(f.configurationSource, JSON.stringify(after), { mode: 0o600 });
  await expect(createNodeCliConfigurationTransition(f, f.admission)).rejects.toMatchObject({
    code: "service_upgrade_unknown",
  });
  after.discordConversations[0].conversations[0] = shared;
  after.discordConversations[0].deliberation.cliExecutable = resolve(f.root, "new-cli");
  await writeFile(f.configurationSource, JSON.stringify(after), { mode: 0o600 });
  await expect(createNodeCliConfigurationTransition(f, f.admission)).rejects.toMatchObject({
    code: "service_upgrade_unknown",
  });
});

it("retains interrupted binding replacement and refuses a replay", async () => {
  const f = await fixture();
  const transition = await createNodeCliConfigurationTransition(f, {
    replaceConfiguration: () => false,
  });
  await expect(transition.apply()).rejects.toMatchObject({ code: "service_upgrade_unknown" });
  expect(JSON.parse(await readFile(`${f.config}.cli-transition.json`, "utf8")).state).toBe(
    "applying",
  );
  await expect(createNodeCliConfigurationTransition(f, f.admission)).rejects.toMatchObject({
    code: "service_upgrade_unknown",
  });
  expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(f.after);
});

it("fails closed on source drift and unsafe candidate permissions", async () => {
  const f = await fixture();
  await chmod(f.configurationSource, 0o644);
  await expect(createNodeCliConfigurationTransition(f, f.admission)).rejects.toMatchObject({
    code: "service_upgrade_unknown",
  });
  await chmod(f.configurationSource, 0o600);
  const transition = await createNodeCliConfigurationTransition(f, f.admission);
  await writeFile(f.config, JSON.stringify({ ...f.before, userOwned: "new value" }));
  await expect(transition.apply()).rejects.toMatchObject({ code: "service_upgrade_unknown" });
  expect(JSON.parse(await readFile(f.config, "utf8")).userOwned).toBe("new value");
});
