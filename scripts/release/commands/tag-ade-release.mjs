// Tags a prepared ADE release on main as `ade-v<version>` (ADR-0615). No CLI workflow matches
// the tag, and the ADE creates no GitHub Release before S3. Without --push it only reports.
import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

import { planAdeTag } from "../lib/ade-release.mjs";

const execFile = promisify(execFileCallback);

try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { root: { type: "string" }, push: { type: "boolean" } },
  });
  const root = resolve(values.root ?? ".");
  const git = async (...args) => (await execFile("git", args, { cwd: root })).stdout.trim();
  const tagExists = async (tag) =>
    (await git("tag", "--list", tag)) !== "" ||
    (await git("ls-remote", "--tags", "origin", `refs/tags/${tag}`)) !== "";
  const plan = await planAdeTag(root, tagExists);
  if (plan.tag === null) {
    process.stdout.write(`No ADE tag: ${plan.reason}.\n`);
  } else if (!values.push) {
    process.stdout.write(`Would tag ${plan.tag} at ${await git("rev-parse", "HEAD")}.\n`);
  } else {
    await git("tag", "--annotate", plan.tag, "--message", plan.message, "HEAD");
    await git("push", "origin", `refs/tags/${plan.tag}`);
    process.stdout.write(`Tagged ${plan.tag}.\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
