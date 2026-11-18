import { describe, expect, it } from "vitest";

import { extractPublicReadmeCoordinates } from "../src/index.js";

describe("public README coordinates", () => {
  it("extracts presentation, package, command, link, and accessibility coordinates deterministically", () => {
    const content = `# Package\n\n![Accessible logo](logo.svg)\n\n[Security](SECURITY.md)\n\n\`\`\`sh\npnpm add @scope/pkg\n\`\`\`\n`;
    const first = extractPublicReadmeCoordinates(content);
    expect(first.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "accessibility_text",
        "fenced_command",
        "image",
        "package_name",
        "security_link",
      ]),
    );
    expect(extractPublicReadmeCoordinates(content)).toEqual(first);
  });
});
