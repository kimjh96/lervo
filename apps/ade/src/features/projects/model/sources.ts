import { workspaceTitle } from "@lervo/session-host-contract";

/**
 * Where a new project comes from, read from what the person typed (Lervo ADE projects, "Adding a
 * project"): a lone repository link clones it, and any other text names a new project after its
 * first words.
 */
export type ProjectSource =
  | { readonly kind: "clone"; readonly url: string; readonly name: string }
  | { readonly kind: "new"; readonly name: string };

/** A display name has at most 80 characters (Lervo ADE projects, "Project profile"). */
const MAXIMUM_NAME_CHARACTERS = 80;

const LINK = /^(?:(?:https?|ssh|git):\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/u;

/** The repository's name in a clone link, such as `argo` for `git@host:acme/argo.git`. */
export function linkName(url: string): string | null {
  const last = url
    .replace(/[/\\]+$/u, "")
    .split(/[/:\\]/u)
    .at(-1);
  const name = last?.replace(/\.git$/u, "") ?? "";
  return /^[A-Za-z0-9._-]{1,100}$/u.test(name) && name !== "." && name !== ".." ? name : null;
}

/** What the text asks for: a clone for a lone repository link, a new project for other text. */
export function projectSourceOf(text: string): ProjectSource | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (LINK.test(trimmed)) {
    const name = linkName(trimmed);
    if (name !== null) return { kind: "clone", url: trimmed, name };
  }
  const title = workspaceTitle(trimmed).replace(/…$/u, "");
  return { kind: "new", name: [...title].slice(0, MAXIMUM_NAME_CHARACTERS).join("").trim() };
}

/** The longest folder name the core gives a new project, in characters. */
const MAXIMUM_FOLDER_NAME = 40;

/**
 * The folder a new project named `name` gets, as the core names it: the name's ASCII words joined
 * by hyphens, at most 40 characters; null when the core would fall back to a dated name.
 */
export function folderNameFor(name: string): string | null {
  let folder = "";
  for (const word of name.toLowerCase().match(/[a-z0-9]+/gu) ?? []) {
    const next = folder === "" ? word : `${folder}-${word}`;
    if (next.length > MAXIMUM_FOLDER_NAME) break;
    folder = next;
  }
  return folder.length >= 2 ? folder : null;
}
