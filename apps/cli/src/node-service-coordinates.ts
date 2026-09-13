import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  parseNodeServiceCoordinates,
  type ParsedNodeServiceCoordinates,
} from "./node-service-coordinate-parser.js";
export { parseNodeServiceCoordinates } from "./node-service-coordinate-parser.js";

export interface NodeServiceCoordinates extends ParsedNodeServiceCoordinates {
  contentHash: string;
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
    ...(coordinates.nodeExecutable === undefined
      ? {}
      : { nodeExecutable: resolve(coordinates.nodeExecutable) }),
    executable: resolve(coordinates.executable),
    config: resolve(coordinates.config),
    contentHash,
  };
}
