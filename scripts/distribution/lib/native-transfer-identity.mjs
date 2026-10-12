import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function nativeTransferIdentity(root) {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error("native_transfer_revision_invalid");
  return {
    revision,
    workflow: process.env.GITHUB_WORKFLOW ?? "local",
    runId: process.env.GITHUB_RUN_ID ?? "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
  };
}

export async function readNativeTransferReceipt(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("native_transfer_directory_invalid");
  const path = resolve(directory, "receipt.json"),
    stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
    throw new Error("native_transfer_receipt_invalid");
  const bytes = await readFile(path);
  if (bytes.length > 4096) throw new Error("native_transfer_receipt_invalid");
  return JSON.parse(bytes.toString("utf8"));
}

export function nativeTransferCoordinatesMatch(receipt, expected) {
  const attemptValid =
    expected.runAttempt === "local"
      ? receipt.runAttempt === "local"
      : typeof receipt.runAttempt === "string" &&
        /^\d+$/u.test(receipt.runAttempt) &&
        Number(receipt.runAttempt) >= 1 &&
        Number(receipt.runAttempt) <= Number(expected.runAttempt);
  return (
    attemptValid && ["revision", "workflow", "runId"].every((key) => receipt[key] === expected[key])
  );
}
