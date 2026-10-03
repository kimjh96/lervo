import { posix } from "node:path";

import { ContextPreparationError, readRepositoryFile } from "@lervo/context";

export function pathTerms(path: string): Set<string> {
  return new Set(
    path
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
  );
}

export async function contextQuery(root: string, paths: readonly string[]): Promise<string> {
  const terms: string[] = [];
  const add = (values: Iterable<string>, maximum: number) => {
    let added = 0;
    for (const term of values) {
      if (terms.length === 32 || added === maximum) break;
      if (terms.includes(term) || [...terms, term].join(" ").length > 500) continue;
      terms.push(term);
      added += 1;
    }
  };
  add(
    paths.flatMap((path) => [...pathTerms(path)]),
    32,
  );
  for (const path of paths.filter((source) => /\.mdx?$/iu.test(source)).slice(0, 8)) {
    let source: string;
    try {
      source = new TextDecoder("utf8", { fatal: true }).decode(
        await readRepositoryFile(root, path, 256 * 1024),
      );
    } catch (error) {
      if (error instanceof ContextPreparationError && error.code === "document_missing") continue;
      throw error;
    }
    add(
      [...source.matchAll(/^\s{0,3}#{1,6}\s+(.+)$/gmu)].flatMap((match) => [
        ...pathTerms(match[1]!),
      ]),
      12,
    );
    add(
      [...source.matchAll(/`([^`\n]+\.md)`/gu)].flatMap((match) => [...pathTerms(match[1]!)]),
      5,
    );
    add(
      [...source.matchAll(/\bnever\s+([^.!?\n]{0,100})/giu)].flatMap((match) => [
        ...pathTerms(match[1]!),
      ]),
      3,
    );
  }
  return terms.join(" ") || "repository knowledge canonicalization";
}

export async function sourceSpecificQueries(root: string, paths: readonly string[]) {
  const focused: { query: string; eventBearing: boolean }[] = [];
  for (const path of paths) {
    if (path === ".github/PULL_REQUEST_TEMPLATE.md")
      focused.push({ query: "pull request evidence contract", eventBearing: false });
    if (path === "apps/cli/package.json")
      focused.push({ query: "cli bundle construction", eventBearing: false });
    if (!/\.[cm]?[jt]sx?$/u.test(path)) continue;
    let source: string;
    try {
      source = new TextDecoder("utf8", { fatal: true }).decode(
        await readRepositoryFile(root, path, 256 * 1024),
      );
    } catch (error) {
      if (error instanceof ContextPreparationError && error.code === "document_missing") continue;
      throw error;
    }
    const terms = [...pathTerms(posix.basename(path))].filter(
      (term) => !["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(term),
    );
    if (!terms.length) continue;
    const eventBearing =
      /\b(?:events|transaction)\.append\s*\(/u.test(source) &&
      /["'][a-z]+(?:\.[a-z]+){2,}["']/u.test(source);
    if (eventBearing)
      focused.push({
        query: [...terms, "event", "idempotency", "recovery"].join(" "),
        eventBearing: true,
      });
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path))
      focused.push({
        query: [...terms.filter((term) => term !== "test" && term !== "spec"), "contract"].join(
          " ",
        ),
        eventBearing: false,
      });
    if (
      path.startsWith("apps/cli/src/") &&
      terms.includes("knowledge") &&
      terms.includes("command")
    )
      focused.push({
        query: [...terms, "cli", "wrappers"].join(" "),
        eventBearing: false,
      });
    if (
      path.startsWith("apps/cli/src/") &&
      terms.includes("repository") &&
      terms.includes("change")
    )
      focused.push({
        query: "repository change adapter boundaries",
        eventBearing: false,
      });
    if (path === "apps/cli/src/terminal-prompt-context.ts")
      focused.push({
        query: "prompt assembly emitted completion instructions",
        eventBearing: false,
      });
    focused.push({ query: terms.join(" "), eventBearing: false });
  }
  return focused.sort((left, right) => Number(right.eventBearing) - Number(left.eventBearing));
}
