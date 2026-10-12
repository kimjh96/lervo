import type { ProjectManifest } from "@lervo/schemas";
import { parseAndValidateYaml } from "./yaml-contract.js";

interface ParsedManifest {
  value: ProjectManifest;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Reuses decoding of exact, freshly read bytes; callers never share mutable manifest objects. */
export function createProjectManifestParser() {
  const entries = new Map<string, ParsedManifest>();
  function remove(content: string) {
    const entry = entries.get(content);
    if (entry) clearTimeout(entry.timer);
    entries.delete(content);
  }
  return (content: string): ProjectManifest => {
    const existing = entries.get(content);
    if (existing && performance.now() < existing.expiresAt) return structuredClone(existing.value);
    if (existing) remove(content);
    const value = parseAndValidateYaml<ProjectManifest>("project", content);
    if (Buffer.byteLength(content, "utf8") <= 64 * 1024) {
      if (entries.size >= 8) remove(entries.keys().next().value!);
      const timer = setTimeout(() => remove(content), 1000);
      timer.unref();
      entries.set(content, {
        value: structuredClone(value),
        expiresAt: performance.now() + 1000,
        timer,
      });
    }
    return value;
  };
}
