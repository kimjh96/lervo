import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { reconcilePoModelPolicy } from "./po-model-policy.mjs";

const defaultPolicyPath = fileURLToPath(new URL("./po-model-policy.json", import.meta.url));

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function optionsFromArgs(args) {
  const options = { policy: defaultPolicyPath, configs: [], backupDir: null, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--apply") {
      options.apply = true;
    } else if (["--policy", "--config", "--backup-dir"].includes(flag)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a path.`);
      if (flag === "--policy") options.policy = resolve(value);
      if (flag === "--config") options.configs.push(resolve(value));
      if (flag === "--backup-dir") options.backupDir = resolve(value);
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.configs.length === 0 || new Set(options.configs).size !== options.configs.length) {
    throw new Error("Pass one or more distinct --config paths.");
  }
  if (options.apply && options.backupDir === null) {
    throw new Error("--apply requires an explicit --backup-dir.");
  }
  if (new Set(options.configs.map((path) => basename(path))).size !== options.configs.length) {
    throw new Error("Configuration basenames must be distinct for backup safety.");
  }
  return options;
}

async function inspect(path, policy) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Configuration is not a regular file: ${path}`);
  }
  const before = await readFile(path);
  const after = Buffer.from(
    `${JSON.stringify(reconcilePoModelPolicy(JSON.parse(before.toString("utf8")), policy), null, 2)}\n`,
  );
  return { path, before, after, beforeHash: digest(before), afterHash: digest(after) };
}

async function applyOne(item, backupDir) {
  if (item.beforeHash === item.afterHash) return;
  if (digest(await readFile(item.path)) !== item.beforeHash) {
    throw new Error(`Configuration changed after inspection: ${item.path}`);
  }
  const backup = resolve(backupDir, `${basename(item.path)}.${item.beforeHash.slice(7, 19)}.bak`);
  await copyFile(item.path, backup, constants.COPYFILE_EXCL);
  await chmod(backup, 0o600);
  const temporary = resolve(dirname(item.path), `.${basename(item.path)}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, item.after, { flag: "wx", mode: 0o600 });
    await rename(temporary, item.path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  if (digest(await readFile(item.path)) !== item.afterHash) {
    throw new Error(`Configuration verification failed: ${item.path}`);
  }
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  const policyBytes = await readFile(options.policy);
  const policy = JSON.parse(policyBytes.toString("utf8"));
  const items = await Promise.all(options.configs.map((path) => inspect(path, policy)));
  if (options.apply) {
    await mkdir(options.backupDir, { recursive: true, mode: 0o700 });
    const metadata = await lstat(options.backupDir);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Backup target is not a real directory.");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("Backup directory must be private to its owner.");
    }
    for (const item of items) await applyOne(item, options.backupDir);
  }
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      applied: options.apply,
      policyHash: digest(policyBytes),
      configurations: items.map((item) => ({
        path: item.path,
        beforeHash: item.beforeHash,
        afterHash: item.afterHash,
        changed: item.beforeHash !== item.afterHash,
      })),
    })}\n`,
  );
}

await main();
