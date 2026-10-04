import { lstatSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "@lervo/repository-knowledge";
import {
  symbolicReferenceTarget,
  type ConvergenceSourceCapturePolicy,
} from "./source-capture-contract.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

type SymbolicReference = ConvergenceSourceCapturePolicy["symbolicReferences"][number];

/** Capture only the exact link descriptor; neither target bodies nor directory aliases are traversed. */
export function symbolicConvergenceSourceBytes(root: string, reference: SymbolicReference): Buffer {
  let link = resolve(root);
  const parts = reference.path.split("/");
  for (const part of parts.slice(0, -1)) {
    link = resolve(link, part);
    const stat = lstatSync(link);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
  }
  link = resolve(link, parts.at(-1)!);
  if (!lstatSync(link).isSymbolicLink() || readlinkSync(link) !== reference.target)
    throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
  try {
    let target = resolve(root);
    for (const part of symbolicReferenceTarget(reference).split("/")) {
      target = resolve(target, part);
      if (lstatSync(target).isSymbolicLink())
        throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
    }
    const stat = lstatSync(target);
    if (reference.targetKind === "file" ? !stat.isFile() : !stat.isDirectory())
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported", {
      cause: error,
    });
  }
  if (readlinkSync(link) !== reference.target || !lstatSync(link).isSymbolicLink())
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  return Buffer.from(`\0${canonicalJson({ kind: "repository_symbolic_reference", ...reference })}`);
}

export function assertSymbolicTargetsCaptured(
  references: readonly SymbolicReference[],
  paths: readonly string[],
): void {
  for (const reference of references) {
    if (!paths.includes(reference.path)) continue;
    const target = symbolicReferenceTarget(reference);
    if (
      reference.targetKind === "file"
        ? !paths.includes(target)
        : !paths.some((path) => path.startsWith(`${target}/`))
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
  }
}
