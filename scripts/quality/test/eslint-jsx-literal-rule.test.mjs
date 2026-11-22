import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";

import { noJsxLiteralsRule } from "../lib/eslint-jsx-literal-rule.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-jsx-literals", noJsxLiteralsRule, {
  valid: [
    "const view = <h1>{messages.title}</h1>;",
    'const view = <svg viewBox="0 0 48 48" aria-hidden="true" />;',
    'const view = <button aria-label={messages.close} type="button" />;',
    "const view = <p>\n  {messages.body}\n</p>;",
    'const view = <input placeholder={format("hint")} />;',
  ],
  invalid: [
    { code: "const view = <h1>Start</h1>;", errors: [{ messageId: "text" }] },
    { code: 'const view = <h1>{"Start"}</h1>;', errors: [{ messageId: "text" }] },
    { code: "const view = <h1>{`Start ${name}`}</h1>;", errors: [{ messageId: "text" }] },
    {
      code: 'const view = <button aria-label="Close" type="button" />;',
      errors: [{ messageId: "attribute", data: { name: "aria-label" } }],
    },
    {
      code: 'const view = <img alt={"Logo"} src={source} />;',
      errors: [{ messageId: "attribute", data: { name: "alt" } }],
    },
    {
      code: 'const view = <input placeholder="Describe the work" />;',
      errors: [{ messageId: "attribute", data: { name: "placeholder" } }],
    },
  ],
});
