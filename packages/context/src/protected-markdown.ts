import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";

/** Preserve code and quoted material as exact source bytes, independently of publication language. */
export function protectedMarkdownDigests(bytes: Uint8Array): string[] {
  if (bytes.byteLength > 1048576) throw new TypeError("Artifact exceeds the verification bound.");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const digests: string[] = [];
  type Node = {
    type: string;
    position?:
      { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined;
    children?: Node[] | undefined;
  };
  const visit = (node: Node) => {
    if (["code", "inlineCode", "blockquote"].includes(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined)
        throw new TypeError("Protected source range is unavailable.");
      digests.push(`sha256:${createHash("sha256").update(text.slice(start, end)).digest("hex")}`);
    } else for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(text));
  // Moving an unchanged quotation is allowed. Multiplicity is retained; deletion is not.
  return digests.sort();
}
