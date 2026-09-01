import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { NodeFleetServiceManager } from "@lervo/repository-registry";

import { failNodeFleetApply, type NodeFleetApplyPorts } from "./node-fleet-apply-contract.js";

export async function transitionLegacyNodeSingleton(input: {
  manager: NodeFleetServiceManager;
  path: string;
  contentHash: string;
  configPath: string;
  homeDirectory?: string;
  serviceOptions?: NodeFleetApplyPorts["serviceOptions"];
}): Promise<void> {
  const bytes = await readFile(input.path);
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== input.contentHash) {
    failNodeFleetApply("node_fleet_plan_stale", "The legacy service changed before transition.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (input.manager === "launchd") {
    if (
      !text.includes("<string>com.lervo.node</string>") ||
      !text.includes("<string>--config</string>") ||
      !text.includes(
        input.configPath.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      )
    ) {
      failNodeFleetApply(
        "node_fleet_legacy_transition_required",
        "The legacy launchd service is not the exact repository Node being replaced.",
      );
    }
  } else if (
    !text.includes("Description=Lervo Node") ||
    !text.includes("--config") ||
    !text.includes(input.configPath)
  ) {
    failNodeFleetApply(
      "node_fleet_legacy_transition_required",
      "The legacy systemd service is not the exact repository Node being replaced.",
    );
  }
  const run =
    input.serviceOptions?.runCommand ??
    (async (command: string, args: string[]) => {
      const { execFile } = await import("node:child_process");
      return new Promise<{ exitCode: number | null }>((done) =>
        execFile(command, args, { timeout: 30_000, windowsHide: true }, (error) =>
          done({
            exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : null,
          }),
        ),
      );
    });
  const wait =
    input.serviceOptions?.wait ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  const uid =
    input.serviceOptions?.uid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  if (input.manager === "launchd" && (!Number.isSafeInteger(uid) || uid! < 0)) {
    failNodeFleetApply(
      "node_fleet_legacy_transition_failed",
      "The launchd user domain is unavailable.",
    );
  }
  const identity = input.manager === "launchd" ? `gui/${uid}/com.lervo.node` : "lervo-node.service";
  const stopped =
    input.manager === "launchd"
      ? (await run("launchctl", ["bootout", identity])).exitCode === 0 ||
        (await run("launchctl", ["print", identity])).exitCode !== 0
      : (await run("systemctl", ["--user", "disable", "--now", identity])).exitCode === 0;
  if (!stopped) {
    failNodeFleetApply(
      "node_fleet_legacy_transition_failed",
      "The legacy singleton could not be stopped.",
    );
  }
  if (input.manager === "launchd") await run("launchctl", ["disable", identity]);
  let consecutive = 0;
  for (let observation = 0; observation < 6 && consecutive < 3; observation += 1) {
    const active =
      input.manager === "launchd"
        ? (await run("launchctl", ["print", identity])).exitCode === 0
        : (await run("systemctl", ["--user", "is-active", identity])).exitCode === 0;
    consecutive = active ? 0 : consecutive + 1;
    if (consecutive < 3) await wait(500);
  }
  if (consecutive < 3) {
    failNodeFleetApply(
      "node_fleet_legacy_transition_failed",
      "The legacy singleton did not remain stopped.",
    );
  }
  const home = resolve(input.homeDirectory ?? homedir());
  const archiveDirectory =
    input.manager === "launchd"
      ? resolve(home, "Library", "Application Support", "Lervo", "retired-services")
      : resolve(home, ".local", "share", "lervo", "retired-services");
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  const suffix = input.contentHash.slice("sha256:".length, "sha256:".length + 16);
  const archive = resolve(
    archiveDirectory,
    `${input.manager === "launchd" ? "com.lervo.node.plist" : "lervo-node.service"}.${suffix}.retired`,
  );
  try {
    await rename(input.path, archive);
  } catch (error) {
    failNodeFleetApply(
      "node_fleet_legacy_transition_failed",
      "The stopped legacy definition could not be archived safely.",
      error,
    );
  }
  await chmod(archive, 0o600);
}
