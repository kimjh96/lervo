import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
