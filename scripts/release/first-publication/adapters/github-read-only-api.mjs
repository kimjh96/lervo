import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const defaultGitHubCliExecute = promisify(execFile);

export async function getGitHubApiJson(
  execute,
  path,
  environment = process.env,
  maximumBytes = 2 * 1024 * 1024,
) {
  const { stdout } = await execute(
    "gh",
    [
      "api",
      "--method",
      "GET",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
      path,
    ],
    {
      encoding: "utf8",
      maxBuffer: maximumBytes,
      timeout: 30_000,
      env: {
        ...environment,
        GH_PAGER: "cat",
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
      },
    },
  );
  return JSON.parse(stdout);
}

export async function getGitHubApiBuffer(
  execute,
  path,
  environment = process.env,
  maximumBytes = 2 * 1024 * 1024,
) {
  const { stdout } = await execute(
    "gh",
    [
      "api",
      "--method",
      "GET",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
      path,
    ],
    {
      encoding: null,
      maxBuffer: maximumBytes,
      timeout: 30_000,
      env: {
        ...environment,
        GH_PAGER: "cat",
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
      },
    },
  );
  if (!Buffer.isBuffer(stdout)) throw new TypeError("GitHub response is not binary");
  return stdout;
}
