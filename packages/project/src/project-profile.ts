import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * A project's display name and optional mark (Lervo ADE projects, "Project profile"). The profile
 * lives beside the manifest, never in it, so writing it leaves `.lervo/project.yaml` and its hash
 * unchanged and no host's registry entry goes stale (ADR-0169, ADR-0637).
 */
export interface ProjectProfileV1 {
  schemaVersion: 1;
  kind: "lervo_project_profile";
  displayName: string;
  mark: ProjectMark | null;
}

export type ProjectMarkMediaType = "image/png" | "image/jpeg" | "image/webp";

/** A mark image, named by the SHA-256 of its bytes and stored once under `.lervo/assets`. */
export interface ProjectMark {
  sha256: string;
  mediaType: ProjectMarkMediaType;
}

export type ProjectProfileFailure =
  "project_name_invalid" | "project_mark_invalid" | "project_profile_invalid";

export class ProjectProfileError extends Error {
  constructor(
    readonly code: ProjectProfileFailure,
    message: string,
  ) {
    super(message);
    this.name = "ProjectProfileError";
  }
}

export const PROJECT_PROFILE_PATH = ".lervo/project-profile.json";
export const PROJECT_ASSETS_DIRECTORY = ".lervo/assets";

const MAXIMUM_NAME_CHARACTERS = 80;
export const MAXIMUM_MARK_BYTES = 512 * 1024;
const MINIMUM_MARK_SIDE = 16;
const MAXIMUM_MARK_SIDE = 1024;

const extensions: Record<ProjectMarkMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** A display name as the profile keeps it: trimmed, 1 to 80 characters, on one line. */
export function validDisplayName(name: string): string {
  const trimmed = name.trim();
  const characters = [...trimmed].length;
  if (
    characters === 0 ||
    characters > MAXIMUM_NAME_CHARACTERS ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  )
    throw new ProjectProfileError(
      "project_name_invalid",
      `A project name has 1 to ${MAXIMUM_NAME_CHARACTERS} characters on one line.`,
    );
  return trimmed;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** The image's format from its own signature, never from a file name. */
function markMediaType(bytes: Uint8Array): ProjectMarkMediaType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return undefined;
}

/** Width and height from the image's header, or undefined when the header does not tell them. */
function markSize(
  mediaType: ProjectMarkMediaType,
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (offset: number, length: number) => offset + length <= bytes.length;
  if (mediaType === "image/png")
    return has(16, 8) ? { width: view.getUint32(16), height: view.getUint32(20) } : undefined;
  if (mediaType === "image/webp") {
    if (!has(12, 4)) return undefined;
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8 " && has(26, 4))
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L" && has(21, 4)) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X" && has(24, 6))
      return {
        width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
        height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
      };
    return undefined;
  }
  // JPEG: the first start-of-frame marker holds the size; other segments are skipped by length.
  let offset = 2;
  while (has(offset, 4) && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!;
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame && has(offset + 5, 4))
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

/**
 * The mark for an image's bytes, or `project_mark_invalid` when its format, size, or dimensions
 * fall outside the bound: PNG, JPEG, or WebP by signature, at most 512 KiB, 16 to 1,024 pixels a
 * side. SVG and every other format are refused.
 */
export function inspectMarkImage(bytes: Uint8Array): ProjectMark {
  const refuse = (reason: string): never => {
    throw new ProjectProfileError("project_mark_invalid", reason);
  };
  if (bytes.length > MAXIMUM_MARK_BYTES) refuse("A mark image is at most 512 KiB.");
  const mediaType = markMediaType(bytes) ?? refuse("A mark image is a PNG, JPEG, or WebP file.");
  const size = markSize(mediaType, bytes) ?? refuse("The mark image's size cannot be read.");
  const fits = (side: number) => side >= MINIMUM_MARK_SIDE && side <= MAXIMUM_MARK_SIDE;
  if (!fits(size.width) || !fits(size.height))
    refuse(`A mark image is ${MINIMUM_MARK_SIDE} to ${MAXIMUM_MARK_SIDE} pixels a side.`);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), mediaType };
}

function parseProfile(value: unknown): ProjectProfileV1 | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<ProjectProfileV1>;
  if (candidate.schemaVersion !== 1 || candidate.kind !== "lervo_project_profile") return null;
  if (typeof candidate.displayName !== "string") return null;
  try {
    validDisplayName(candidate.displayName);
  } catch {
    return null;
  }
  const mark = candidate.mark;
  if (mark === null)
    return {
      schemaVersion: 1,
      kind: "lervo_project_profile",
      displayName: candidate.displayName,
      mark,
    };
  if (
    typeof mark !== "object" ||
    mark === undefined ||
    typeof mark.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(mark.sha256) ||
    !Object.hasOwn(extensions, mark.mediaType)
  )
    return null;
  return {
    schemaVersion: 1,
    kind: "lervo_project_profile",
    displayName: candidate.displayName,
    mark: { sha256: mark.sha256, mediaType: mark.mediaType },
  };
}

/** What a reader found: the profile, none, or a file that does not match its schema. */
export type ProjectProfileRead =
  { state: "present"; profile: ProjectProfileV1 } | { state: "absent" } | { state: "invalid" };

/** Reads the profile. A reader never rewrites an invalid file; it treats it as no profile. */
export async function readProjectProfile(root: string): Promise<ProjectProfileRead> {
  let text: string;
  try {
    text = await readFile(resolve(root, PROJECT_PROFILE_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent" };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "invalid" };
  }
  const profile = parseProfile(parsed);
  return profile === null ? { state: "invalid" } : { state: "present", profile };
}

/** The repository-relative path of a mark's image. */
export function markAssetPath(mark: ProjectMark): string {
  return `${PROJECT_ASSETS_DIRECTORY}/${mark.sha256}.${extensions[mark.mediaType]}`;
}

async function writeAtomically(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o644, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeProfile(root: string, profile: ProjectProfileV1): Promise<void> {
  await writeAtomically(
    resolve(root, PROJECT_PROFILE_PATH),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
}

/** The profile a change starts from: the present one, or the manifest's name and no mark. */
async function currentProfile(root: string, manifestName: string): Promise<ProjectProfileV1> {
  const read = await readProjectProfile(root);
  if (read.state === "present") return read.profile;
  return { schemaVersion: 1, kind: "lervo_project_profile", displayName: manifestName, mark: null };
}

/** Writes a new display name and returns the profile before and after. */
export async function renameProject(
  root: string,
  manifestName: string,
  name: string,
): Promise<{ before: ProjectProfileV1; after: ProjectProfileV1 }> {
  const displayName = validDisplayName(name);
  const before = await currentProfile(root, manifestName);
  const after: ProjectProfileV1 = { ...before, displayName };
  await writeProfile(root, after);
  return { before, after };
}

async function removeUnreferencedAsset(
  root: string,
  mark: ProjectMark | null,
  kept: ProjectMark | null,
) {
  if (mark === null || mark.sha256 === kept?.sha256) return;
  await rm(resolve(root, markAssetPath(mark)), { force: true });
}

/** Stores the image once by its hash, names it in the profile, and drops an unused old image. */
export async function setProjectMark(
  root: string,
  manifestName: string,
  bytes: Uint8Array,
): Promise<{ before: ProjectProfileV1; after: ProjectProfileV1 }> {
  const mark = inspectMarkImage(bytes);
  const before = await currentProfile(root, manifestName);
  await writeAtomically(resolve(root, markAssetPath(mark)), bytes);
  const after: ProjectProfileV1 = { ...before, mark };
  await writeProfile(root, after);
  await removeUnreferencedAsset(root, before.mark, mark);
  return { before, after };
}

/** Clears the mark, so the first letter shows again, and drops its image. */
export async function clearProjectMark(
  root: string,
  manifestName: string,
): Promise<{ before: ProjectProfileV1; after: ProjectProfileV1 }> {
  const before = await currentProfile(root, manifestName);
  const after: ProjectProfileV1 = { ...before, mark: null };
  await writeProfile(root, after);
  await removeUnreferencedAsset(root, before.mark, null);
  return { before, after };
}

/** The mark's image bytes, or null when the profile names none or its file is missing. */
export async function readProjectMark(
  root: string,
): Promise<{ mark: ProjectMark; bytes: Buffer } | null> {
  const read = await readProjectProfile(root);
  if (read.state !== "present" || read.profile.mark === null) return null;
  try {
    const bytes = await readFile(resolve(root, markAssetPath(read.profile.mark)));
    return { mark: read.profile.mark, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
