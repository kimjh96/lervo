import { describe, expect, it } from "vitest";
import { sanitizePracticeText } from "../src/practice-privacy.js";

const keys = ["password", "TOKEN", "Secret", "api_key", "Authorization", "cookie", "PRIVATE_KEY"];
describe("practice credential stripping", () => {
  it.each(keys)("drops nested JSON values under %s without masking", (key) => {
    const input = {
      safe: "public",
      nested: [{ [key]: { value: "fixture-credential" }, ok: true }],
    };
    const output = sanitizePracticeText(JSON.stringify(input, null, 2));
    expect(JSON.parse(output)).toEqual({ safe: "public", nested: [{ ok: true }] });
    expect(output).not.toContain("fixture-credential");
  });
  it("recognizes escaped JSON keys and JSON inside a text value", () => {
    expect(sanitizePracticeText('{"\\u0070assword":"fixture-credential"}')).toBe("{}");
    const input = JSON.stringify({ reply: 'Result: {"password":"fixture-credential"}', ok: true });
    expect(JSON.parse(sanitizePracticeText(input))).toEqual({ reply: "", ok: true });
  });
  it("drops fenced or incomplete JSON with multiline secret values", () => {
    expect(
      sanitizePracticeText('```json\n{"password": {\n"value": "fixture-credential"\n}}\n```'),
    ).toBe("");
    expect(sanitizePracticeText('{"password":\n"fixture-credential"')).toBe("");
    expect(sanitizePracticeText('```json\n{"\\u0070assword":"fixture-credential"}\n```')).toBe("");
  });
  it("also drops textual credentials and preserves public text", () => {
    expect(sanitizePracticeText("Public.\npassword=fixture-credential\nDone.")).toBe(
      "Public.\nDone.",
    );
    expect(sanitizePracticeText('{"public":"value"}')).toBe('{"public":"value"}');
  });
});
