import { describe, expect, it } from "vitest";

import {
  extractTerminalFindAnchors,
  formatTerminalFindPointer,
} from "../src/terminal-find-anchors.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const files: Record<string, string> = {
  "AGENTS.md": hash("0"),
  "apps/web/AGENTS.md": hash("1"),
  "apps/web/src/screen.tsx": hash("2"),
  "packages/core/src/screen.tsx": hash("3"),
  "packages/core/src/motion.ts": hash("4"),
  ".agents/skills/eli5/SKILL.md": hash("5"),
  ".agents/skills/flemo/SKILL.md": hash("6"),
  "docs/decisions/execution/grounding/0538-find-governing-context.md": hash("7"),
  "docs/decisions/a/0100-first.md": hash("8"),
  "docs/decisions/b/0100-second.md": hash("9"),
  "README.md": hash("b"),
  "apps/web/app/[lang]/page.tsx": hash("c"),
  "apps/web/app/(shop)/layout.tsx": hash("d"),
  "docs/한국어": hash("e"),
};

describe("exact prompt anchors (ADR-0538)", () => {
  it("anchors exact paths, directories, and unique basenames only", () => {
    const anchors = extractTerminalFindAnchors(
      "apps/web 화면에서 `motion.ts`와 ./apps/web/src/screen.tsx를 고쳐줘. screen.tsx도 봐",
      files,
    );
    expect(anchors.paths).toEqual([
      "apps/web",
      "packages/core/src/motion.ts",
      "apps/web/src/screen.tsx",
    ]);
  });

  it("reads a path with an attached Korean particle", () => {
    expect(
      extractTerminalFindAnchors("apps/web는 그대로 두고 ADR-0538을 따라줘", files),
    ).toMatchObject({
      paths: ["apps/web"],
      pointers: [
        { kind: "decision", name: "ADR-0538" },
        { kind: "instruction", path: "apps/web/AGENTS.md", contentHash: hash("1") },
      ],
    });
  });

  it("names a skill only through an explicit invocation", () => {
    expect(extractTerminalFindAnchors("/eli5 how does the planner work", files).pointers).toEqual([
      { kind: "skill", name: "eli5", path: ".agents/skills/eli5/SKILL.md", contentHash: hash("5") },
    ]);
    expect(extractTerminalFindAnchors("$eli5 explain", files).pointers[0]?.name).toBe("eli5");
    // A repository name that equals a skill identifier names nothing.
    expect(extractTerminalFindAnchors("flemo 전체를 점검해줘", files).pointers).toEqual([]);
  });

  it("names a decision by unique number and ignores ambiguous numbers", () => {
    expect(extractTerminalFindAnchors("ADR-0538 다시 봐", files).pointers).toMatchObject([
      { kind: "decision", name: "ADR-0538" },
    ]);
    expect(extractTerminalFindAnchors("ADR 0538", files).pointers).toHaveLength(1);
    expect(extractTerminalFindAnchors("ADR-0100", files).pointers).toEqual([]);
  });

  it("caps pointers and paths, and formats pointers without bodies", () => {
    const anchors = extractTerminalFindAnchors(
      "/eli5 $flemo ADR-0538 ADR-0538 apps/web/AGENTS.md",
      files,
    );
    expect(anchors.pointers).toHaveLength(3);
    const lines = anchors.pointers.map(formatTerminalFindPointer);
    expect(lines[0]).toBe(
      `Lervo find: skill eli5 (.agents/skills/eli5/SKILL.md, ${hash("5")}), named in the prompt.`,
    );
    const many = Array.from({ length: 40 }, (_, index) => `f${index}.ts`);
    const wide = Object.fromEntries(many.map((path) => [path, hash("a")]));
    expect(extractTerminalFindAnchors(many.join(" "), wide).paths).toHaveLength(16);
  });

  it("ignores free words and is deterministic", () => {
    const prompt = "테스트 구조를 개선해줘 planner motion docs src apps 문서";
    expect(extractTerminalFindAnchors(prompt, files)).toEqual({ paths: [], pointers: [] });
    expect(extractTerminalFindAnchors(prompt, files)).toEqual(
      extractTerminalFindAnchors(prompt, files),
    );
  });

  it("requires path syntax for directories and extensionless names", () => {
    expect(extractTerminalFindAnchors("docs 정리하고 apps/ 확인", files).paths).toEqual(["apps"]);
    expect(extractTerminalFindAnchors("README.md를 갱신해줘", files).paths).toEqual(["README.md"]);
  });

  it("keeps brackets, parentheses, quoted spans, and line suffixes inside one path", () => {
    expect(
      extractTerminalFindAnchors(
        "apps/web/app/[lang]/page.tsx와 (apps/web/app/(shop)/layout.tsx) 그리고 README.md:12",
        files,
      ).paths,
    ).toEqual(["apps/web/app/[lang]/page.tsx", "apps/web/app/(shop)/layout.tsx", "README.md"]);
  });

  it("prefers the exact spelling and strips at most a short attached particle", () => {
    expect(extractTerminalFindAnchors("docs/한국어 문서", files).paths).toEqual(["docs/한국어"]);
    expect(extractTerminalFindAnchors("apps/web에서부터는", files).paths).toEqual([]);
    expect(extractTerminalFindAnchors("/eli5설명", files).pointers).toEqual([]);
  });

  it("stays linear when many files share one basename", () => {
    const shared = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [`p${index}/index.ts`, hash("f")]),
    );
    const started = performance.now();
    expect(extractTerminalFindAnchors("index.ts", shared)).toEqual({ paths: [], pointers: [] });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
