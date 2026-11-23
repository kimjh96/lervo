import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  adeReleaseNotesPath,
  applyAdeRelease,
  checkAdeRelease,
  planAdeRelease,
  planAdeTag,
} from "../lib/ade-release.mjs";
import { createReleaseIntent, loadReleaseIntents } from "../lib/release-intent.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function write(root, path, content) {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
}

/** An ADE with two crates at `version`, and a CLI intent that ADE preparation must not touch. */
async function ade(version = "0.1.0", engines = { lervo: ">=0.42.0" }) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ade-release-"));
  roots.push(root);
  await write(
    root,
    "apps/ade/package.json",
    `${JSON.stringify({ name: "@lervo/ade", version, engines, private: true }, null, 2)}\n`,
  );
  await write(
    root,
    "apps/ade/src-tauri/tauri.conf.json",
    `${JSON.stringify({ productName: "Lervo", version }, null, 2)}\n`,
  );
  await write(
    root,
    "apps/ade/Cargo.toml",
    `[workspace]\nmembers = ["src-tauri", "session-host"]\n\n[workspace.package]\nversion = "${version}"\nedition = "2024"\n`,
  );
  await write(
    root,
    "apps/ade/src-tauri/Cargo.toml",
    `[package]\nname = "lervo-ade"\nversion.workspace = true\n`,
  );
  await write(
    root,
    "apps/ade/session-host/Cargo.toml",
    `[package]\nname = "lervo-session-host"\nversion.workspace = true\n`,
  );
  await write(
    root,
    "apps/ade/Cargo.lock",
    `version = 4\n\n[[package]]\nname = "lervo-ade"\nversion = "${version}"\n\n[[package]]\nname = "lervo-session-host"\nversion = "${version}"\n\n[[package]]\nname = "serde"\nversion = "1.0.228"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`,
  );
  await createReleaseIntent(root, {
    impact: "patch",
    summary: "Correct a CLI behavior that the ADE never touches.",
  });
  return root;
}

const summary = "Show the Lervo mark while the window opens.";

describe("ADE release preparation (ADR-0615)", () => {
  it("prepares nothing without an ADE intent", async () => {
    const root = await ade();
    expect(await planAdeRelease(root)).toBeNull();
    expect(await checkAdeRelease(root)).toMatchObject({ valid: true, version: "0.1.0" });
  });

  it("writes the next version everywhere, with notes that name the CLI it needs", async () => {
    const root = await ade();
    await createReleaseIntent(root, { impact: "minor", summary, target: "ade" });
    await createReleaseIntent(root, {
      impact: "patch",
      summary: "Size the agent chooser to the chosen agent.",
      target: "ade",
    });
    const plan = await planAdeRelease(root);
    expect(plan).toMatchObject({ current: "0.1.0", version: "0.2.0", impact: "minor" });
    await applyAdeRelease(root, plan);

    const read = async (path) => readFile(resolve(root, path), "utf8");
    expect(JSON.parse(await read("apps/ade/package.json"))).toMatchObject({
      version: "0.2.0",
      engines: { lervo: ">=0.42.0" },
    });
    expect(JSON.parse(await read("apps/ade/src-tauri/tauri.conf.json")).version).toBe("0.2.0");
    expect(await read("apps/ade/Cargo.toml")).toContain('[workspace.package]\nversion = "0.2.0"');
    const lock = await read("apps/ade/Cargo.lock");
    expect(lock).toContain('name = "lervo-ade"\nversion = "0.2.0"');
    expect(lock).toContain('name = "lervo-session-host"\nversion = "0.2.0"');
    expect(lock).toContain('name = "serde"\nversion = "1.0.228"');
    expect(await read(adeReleaseNotesPath)).toBe(
      [
        '<!-- lervo-release package="@lervo/ade" version="0.2.0" schema="1" -->',
        "",
        "Needs the Lervo CLI 0.42.0 or later.",
        "",
        "## What's changed",
        "",
        `- ${summary}`,
        "- Size the agent chooser to the chosen agent.",
        "",
      ].join("\n"),
    );
    expect(await loadReleaseIntents(root, "ade")).toEqual([]);
    // The CLI's pending intent stays for the CLI's own preparation.
    expect(await loadReleaseIntents(root)).toHaveLength(1);
    expect(await checkAdeRelease(root)).toMatchObject({
      valid: true,
      version: "0.2.0",
      pending: 0,
    });
  });

  it("refuses to prepare when versions disagree or the needed CLI is not named", async () => {
    const mismatched = await ade();
    await write(
      mismatched,
      "apps/ade/src-tauri/tauri.conf.json",
      `${JSON.stringify({ version: "0.1.1" })}\n`,
    );
    await createReleaseIntent(mismatched, { impact: "patch", summary, target: "ade" });
    await expect(planAdeRelease(mismatched)).rejects.toMatchObject({
      code: "ade_version_mismatch",
    });
    expect((await checkAdeRelease(mismatched)).diagnostics).toEqual([
      "ade_version_mismatch: apps/ade/src-tauri/tauri.conf.json",
    ]);

    const unnamed = await ade("0.1.0", {});
    await createReleaseIntent(unnamed, { impact: "patch", summary, target: "ade" });
    await expect(planAdeRelease(unnamed)).rejects.toMatchObject({
      code: "ade_minimum_cli_missing",
    });
  });

  it("tags a prepared release once, and never while intents are pending", async () => {
    const root = await ade();
    const none = async () => false;
    expect(await planAdeTag(root, none)).toMatchObject({
      tag: null,
      reason: "ade_release_notes_missing",
    });
    await createReleaseIntent(root, { impact: "minor", summary, target: "ade" });
    await applyAdeRelease(root, await planAdeRelease(root));
    expect(await planAdeTag(root, none)).toMatchObject({
      tag: "ade-v0.2.0",
      message: "Lervo ADE 0.2.0",
    });
    expect(await planAdeTag(root, async (tag) => tag === "ade-v0.2.0")).toMatchObject({
      tag: null,
      reason: "ade_release_tagged",
    });
    await createReleaseIntent(root, {
      impact: "patch",
      summary: "Size the agent chooser to the chosen agent.",
      target: "ade",
    });
    expect(await planAdeTag(root, none)).toMatchObject({
      tag: null,
      reason: "ade_release_intent_pending",
    });
  });
});
