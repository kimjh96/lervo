import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  darwinToolchainFields,
  darwinToolchainMismatches,
  darwinToolchainPin,
} from "./lib/darwin-toolchain.mjs";

// Runs before a darwin native build whose bytes a release records (ADR-0581). A different
// compiler or SDK would silently change those bytes, so any difference from the pin fails here.
if (process.argv.length > 2) throw new Error("Usage: check-darwin-toolchain.mjs");
const run = promisify(execFile);
const queries = {
  developerDir: ["xcode-select", ["-p"]],
  xcode: ["xcodebuild", ["-version"]],
  clang: ["xcrun", ["clang", "--version"]],
  sdk: ["xcrun", ["--sdk", "macosx", "--show-sdk-version"]],
  sdkBuild: ["xcrun", ["--sdk", "macosx", "--show-sdk-build-version"]],
};
const observed = {};
for (const field of darwinToolchainFields) {
  const [command, args] = queries[field];
  try {
    observed[field] = (await run(command, args)).stdout.split("\n")[0].trim();
  } catch {
    // An unavailable Xcode or SDK is a mismatch, reported with the other fields.
    observed[field] = null;
  }
}
const mismatches = darwinToolchainMismatches(observed);
const record = {
  schemaVersion: 1,
  status: mismatches.length ? "mismatch" : "pinned",
  mismatches,
  pin: darwinToolchainPin,
  observed,
};
process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `Darwin toolchain: ${record.status} (${observed.xcode}; ${observed.clang}; SDK ${observed.sdk} ${observed.sdkBuild})\n`,
  );
if (mismatches.length) {
  process.stderr.write(`darwin_toolchain_mismatch: ${mismatches.join(", ")}\n`);
  process.exitCode = 1;
}
