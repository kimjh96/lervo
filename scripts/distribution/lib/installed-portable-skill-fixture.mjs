import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const installedPortableSkillRequest = "Use the packaged repository testing workflow";
export const installedPortableSkillInstructions =
  "---\nname: installed-testing\ndescription: Use the packaged repository testing workflow.\n---\n\n# Capability skill\n\nUse the exact managed skill route.\n";

async function authorizeAndMigrate(input) {
  const planPath = resolve(input.root, ".lervo/state/installed-skill-authorization-plan.json");
  const invoke = async (args) =>
    JSON.parse((await input.runCli(input.cli, input.root, args)).stdout);
  const plan = await invoke([
    "capability",
    "authorize-skill",
    "--skill",
    "installed-testing",
    "--reviewer",
    "lervo.acceptance",
    "--json",
  ]);
  await mkdir(resolve(input.root, ".lervo/state"), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const authorized = await invoke([
    "capability",
    "authorize-skill",
    "--from",
    planPath,
    "--apply",
    "--json",
  ]);
  assert.equal(authorized.status, "applied");
  const migration = await invoke(["capability", "migrate", "--json"]);
  assert.equal(migration.status, "ready");
  assert.ok(migration.items.some((item) => item.capabilityId === "repository/installed_testing"));
  const migrated = await invoke(["capability", "migrate", "--apply", "--json"]);
  assert.equal(migrated.status, "current");
  return authorized.contentHash;
}

// An authored historical package exercises retained authorization without pattern generation.
export async function prepareInstalledPortableSkillFixture(input) {
  const directory = ".agents/skills/installed-testing";
  const root = resolve(input.root, directory);
  const files = [
    { path: "SKILL.md", content: installedPortableSkillInstructions },
    {
      path: "references/checklist.md",
      content: "# Checklist\n\nRun the configured project verification and retain evidence.\n",
    },
  ];
  const contentHash = input.hashCapabilityFiles(
    files.map(({ path, content }) => ({
      path,
      bytes: new TextEncoder().encode(content),
    })),
  );
  const source = {
    kind: "project",
    uri: directory,
    publisher: { id: "lervo.development-pattern", name: "Lervo development-pattern review" },
  };
  const compatibility = {
    providers: { mode: "allowlist", providers: ["codex"] },
    minimumRuntimeVersion: "0.11.4",
    platforms: [process.platform],
  };
  const skill = {
    schemaVersion: 1,
    skillId: "installed-testing",
    version: "1.0.0",
    contentHash,
    source,
    supportedRoles: ["developer"],
    compatibility: { ...compatibility, requiredTools: ["shell"], unknownIsCompatible: false },
    requiredCapabilities: ["filesystem.read", "shell.execute"],
    contracts: {
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "disabled" },
    pinned: false,
  };
  const manifest = {
    schemaVersion: 1,
    capabilityId: "repository/installed_testing",
    kind: "skill",
    version: "1.0.0",
    contentHash,
    source,
    compatibility,
    requiredPermissions: ["filesystem.read", "shell.execute"],
    dependencies: [
      {
        capabilityId: input.dependency.capabilityId,
        version: input.dependency.version,
        contentHash: input.dependency.contentHash,
      },
    ],
    discovery: {
      displayName: "Installed repository test skill",
      summary: installedPortableSkillRequest,
      keywords: ["repository", "testing"],
      intents: [installedPortableSkillRequest],
      autoSelect: true,
    },
    entrypoint: { kind: "skill", skillId: skill.skillId, manifestPath: "lervo-skill.json" },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await mkdir(resolve(root, "references"), { recursive: true });
  await Promise.all([
    ...files.map(({ path, content }) => writeFile(resolve(root, path), content)),
    writeFile(resolve(root, "lervo-skill.json"), `${JSON.stringify(skill, null, 2)}\n`),
    writeFile(resolve(root, "lervo-capability.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(
      resolve(input.root, "src/result.ts"),
      "export const installedCapabilityJourney = false;\n",
    ),
  ]);
  const authorizedHash = await authorizeAndMigrate(input);
  assert.equal(authorizedHash, contentHash);
  return { manifest, skill };
}
