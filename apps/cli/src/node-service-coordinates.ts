import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface NodeServiceCoordinates {
  executable: string;
  config: string;
  contentHash: string;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function decodeSystemd(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\") {
      const next = value[index + 1];
      if (next !== "\\" && next !== '"') return null;
      decoded += next;
      index += 1;
    } else if (character === "%" && value[index + 1] === "%") {
      decoded += "%";
      index += 1;
    } else decoded += character;
  }
  return decoded;
}

export function parseNodeServiceCoordinates(
  manager: "systemd" | "launchd",
  content: string,
): { executable: string; config: string } | null {
  if (manager === "launchd") {
    const match =
      /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>\s*<string>--config<\/string>\s*<string>([^<]+)<\/string>\s*<\/array>/u.exec(
        content,
      );
    return match === null
      ? null
      : { executable: decodeXml(match[1]!), config: decodeXml(match[2]!) };
  }
  const line = content.split("\n").find((item) => item.startsWith("ExecStart="));
  const match = /^ExecStart="((?:[^"\\]|\\.)*)" --config "((?:[^"\\]|\\.)*)"$/u.exec(line ?? "");
  if (match === null) return null;
  const executable = decodeSystemd(match[1]!);
  const config = decodeSystemd(match[2]!);
  return executable === null || config === null ? null : { executable, config };
}

export async function readNodeServiceCoordinates(input: {
  manager: "systemd" | "launchd";
  path: string;
  expectedContentHash?: string | null;
}): Promise<NodeServiceCoordinates> {
  const metadata = await lstat(input.path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > 64 * 1024 ||
    (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error("The repository Node service definition is unsafe.");
  }
  const content = await readFile(input.path, "utf8");
  const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (input.expectedContentHash !== undefined && input.expectedContentHash !== contentHash) {
    throw new Error("The repository Node service definition changed.");
  }
  const coordinates = parseNodeServiceCoordinates(input.manager, content);
  if (
    coordinates === null ||
    !isAbsolute(coordinates.executable) ||
    !isAbsolute(coordinates.config) ||
    /[\0\r\n]/u.test(`${coordinates.executable}${coordinates.config}`)
  ) {
    throw new Error("The repository Node service coordinates are invalid.");
  }
  return {
    executable: resolve(coordinates.executable),
    config: resolve(coordinates.config),
    contentHash,
  };
}
