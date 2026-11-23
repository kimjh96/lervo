import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Markdown from "../src/features/conversation/view/markdown/Markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("Markdown in agent messages", () => {
  it("renders headings, emphasis, lists, code, quotes, and tables", () => {
    const html = render(
      [
        "## Result",
        "Checks **passed** with `pnpm test`.",
        "- [x] lint",
        "- tests",
        "```rust\nfn main() {}\n```",
        "> Not run: WSL.",
        "| Check | Result |\n| --- | --- |\n| clippy | passed |",
      ].join("\n\n"),
    );
    expect(html).toContain('data-depth="2"');
    expect(html).toContain("<strong>passed</strong>");
    expect(html).toMatch(/<code class="[^"]*">pnpm test<\/code>/u);
    expect(html).toContain("☑ ");
    expect(html).toContain('data-language="rust"');
    expect(html).toContain("fn main() {}");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<td");
  });

  it("shows raw HTML as text and never makes a link navigate", () => {
    const html = render('<img src=x onerror="alert(1)"> and [docs](https://example.com)');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<a ");
    expect(html).toContain('title="https://example.com"');
  });
});
