// What document normalization must keep intact in a Markdown source: its frontmatter, managed
// blocks, lifecycle lines, code, link targets, and provider imports. It also gives each link target
// an identity, so a rewrite that drops a link is found.
import { dirname, posix } from "node:path";

import type {
  DocumentNormalizationEnvelopeDocument,
  DocumentNormalizationProfile,
} from "./document-normalization.js";
import { providerSurfaceImports } from "./provider-surface-descriptors.js";

export function protectedMarkdownFragments(
  content: string,
  profile: DocumentNormalizationProfile,
): DocumentNormalizationEnvelopeDocument["protectedFragments"] {
  const criticalInstruction = [
    "portable_skill",
    "skill_reference",
    "agent_instruction",
    "instruction_document",
  ].includes(profile);
  const portableSkillMaterial = ["portable_skill", "skill_reference"].includes(profile);
  const fragments: DocumentNormalizationEnvelopeDocument["protectedFragments"] = [
    ...(["agent_instruction", "instruction_document", "skill_reference"].includes(profile)
      ? (content.match(/^---\n[\s\S]*?\n---(?:\n|$)/u) ?? []).map((value) => ({
          kind: "frontmatter" as const,
          value,
        }))
      : []),
    ...(content.match(/<!-- lervo:begin\b[^>]*-->[\s\S]*?<!-- lervo:end\b[^>]*-->/gu) ?? []).map(
      (value) => ({ kind: "managed_block" as const, value }),
    ),
    ...(content.match(/^(?:Status|As of):[^\n]*(?:\n|$)/gmu) ?? []).map((value) => ({
      kind: "lifecycle_metadata" as const,
      value,
    })),
    ...(criticalInstruction
      ? (content.match(/```[^\n]*\n[\s\S]*?```/gu) ?? []).map((value) => ({
          kind: "fenced_code" as const,
          value,
        }))
      : []),
    ...(portableSkillMaterial
      ? (content.match(/(?<!`)`[^`\n]+`(?!`)/gu) ?? []).map((value) => ({
          kind: "inline_code" as const,
          value: value.slice(1, -1),
        }))
      : []),
    ...[...content.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map((match) => ({
      kind: "link_target" as const,
      value: match[1]!,
    })),
    ...providerSurfaceImports(content).map((value) => ({
      kind: "provider_import" as const,
      value,
    })),
  ];
  return [
    ...new Map(
      fragments
        .filter((fragment) => fragment.value.length > 0)
        .map((fragment) => [`${fragment.kind}\u0000${fragment.value}`, fragment]),
    ).values(),
  ];
}

function markdownLinkTargetIdentities(path: string, content: string): Set<string> {
  return new Set(
    [...content.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map((match) =>
      resolvedMarkdownLinkTargetIdentity(path, match[1]!),
    ),
  );
}

export function resolvedMarkdownLinkTargetIdentity(path: string, target: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(target)) return `literal:${target}`;
  const suffixIndex = [target.indexOf("?"), target.indexOf("#")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const targetPath = suffixIndex === undefined ? target : target.slice(0, suffixIndex);
  const suffix = suffixIndex === undefined ? "" : target.slice(suffixIndex);
  const resolvedPath =
    targetPath.length === 0 ? path : posix.normalize(posix.join(dirname(path), targetPath));
  return `repository:${resolvedPath}${suffix}`;
}

export function outputMarkdownLinkTargetIdentities(
  outputs: readonly { path: string; content: string }[],
): Set<string> {
  return new Set(
    outputs.flatMap((output) => [...markdownLinkTargetIdentities(output.path, output.content)]),
  );
}
