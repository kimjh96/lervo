import { createManagedBlockPatchCandidate, parseManagedMarkdownBlocks } from "@lervo/documents";

import { sha256 } from "./integrity.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface InstructionBridgeTargetProfile {
  canonicalPath: "AGENTS.md";
  targetPath: "CLAUDE.md";
  blockId: "provider_entry";
}

export type InstructionBridgeTargetClassification =
  "missing" | "exact_adopted_duplicate" | "managed_bridge" | "unresolved_mixed_user_content";

export interface InstructionBridgeTargetOutput {
  content: string;
  action: "create" | "update" | "unchanged";
  classification: InstructionBridgeTargetClassification;
  managedContentHash: string;
}

function managedContent(profile: InstructionBridgeTargetProfile): string {
  return `@${profile.canonicalPath}\n`;
}

function completeTarget(profile: InstructionBridgeTargetProfile): string {
  return [
    `<!-- lervo:begin block=${profile.blockId} schema=1 -->`,
    `@${profile.canonicalPath}`,
    `<!-- lervo:end block=${profile.blockId} -->`,
    "",
  ].join("\n");
}

function separatorFor(content: string): string {
  if (content.length === 0 || content.endsWith("\n\n")) return "";
  return content.endsWith("\n") ? "\n" : "\n\n";
}

function isExactAdoptedDuplicate(input: {
  canonicalContent: string;
  targetContent: string;
  canonicalRouteBlock: string | null;
}): boolean {
  if (input.canonicalRouteBlock === null) return false;
  return (
    `${input.targetContent}${separatorFor(input.targetContent)}${input.canonicalRouteBlock}` ===
    input.canonicalContent
  );
}

export function createInstructionBridgeTarget(input: {
  profile: InstructionBridgeTargetProfile;
  canonicalContent: string;
  canonicalRouteBlock: string | null;
  existing: { content: string; contentHash: string; byteCount: number } | null;
}): InstructionBridgeTargetOutput {
  const replacement = managedContent(input.profile);
  const managedContentHash = sha256(replacement);
  if (input.existing === null) {
    return {
      content: completeTarget(input.profile),
      action: "create",
      classification: "missing",
      managedContentHash,
    };
  }
  const sourceBytes = encoder.encode(input.existing.content);
  const parsed = parseManagedMarkdownBlocks(sourceBytes);
  if (parsed.status !== "valid") throw new Error("invalid_managed_block_structure");
  const block = parsed.blocks.find((item) => item.blockId === input.profile.blockId);
  if (block === undefined) {
    if (
      isExactAdoptedDuplicate({
        canonicalContent: input.canonicalContent,
        targetContent: input.existing.content,
        canonicalRouteBlock: input.canonicalRouteBlock,
      })
    ) {
      return {
        content: completeTarget(input.profile),
        action: "update",
        classification: "exact_adopted_duplicate",
        managedContentHash,
      };
    }
    return {
      content: `${input.existing.content}${separatorFor(input.existing.content)}${completeTarget(input.profile)}`,
      action: "update",
      classification: "unresolved_mixed_user_content",
      managedContentHash,
    };
  }
  const current = sourceBytes.slice(block.contentRange.start, block.contentRange.end);
  if (sha256(current) === managedContentHash && decoder.decode(current) === replacement) {
    return {
      content: input.existing.content,
      action: "unchanged",
      classification: "managed_bridge",
      managedContentHash,
    };
  }
  const patched = createManagedBlockPatchCandidate({
    source: {
      path: input.profile.targetPath,
      contentHash: input.existing.contentHash,
      byteCount: input.existing.byteCount,
      bytes: sourceBytes,
    },
    blockId: input.profile.blockId,
    replacementBytes: encoder.encode(replacement),
  });
  return {
    content: decoder.decode(patched.outputBytes),
    action: "update",
    classification: "managed_bridge",
    managedContentHash,
  };
}
