import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function tarListingLines(stdout, platform = process.platform) {
  // Native Windows tar writes CRLF; a CR on POSIX remains part of the untrusted path.
  return stdout.split(platform === "win32" ? /\r?\n/u : "\n").filter(Boolean);
}

export async function extractTarGzipArchive(archive, destination) {
  await execFileAsync(
    "tar",
    ["--same-permissions", "--no-same-owner", "-xzf", archive, "-C", destination],
    {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
}
