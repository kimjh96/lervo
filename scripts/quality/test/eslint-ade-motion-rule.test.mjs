import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";

import { declaredMotionRule } from "../lib/eslint-ade-motion-rule.mjs";

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

ruleTester.run("declared-motion", declaredMotionRule, {
  valid: [
    "const view = <Presence>{failure === null ? null : <Alert />}</Presence>;",
    "const view = <Presence contentKey={state}>{ready ? <A /> : <B />}</Presence>;",
    "const view = <p>{/* motion: Renaming in place */}{editing ? <Field /> : <Name />}</p>;",
    "const view = <p>{label}</p>;",
    "const view = <ul>\n  {/* motion: Finished status */}\n  {status === null ? null : <Dot />}\n</ul>;",
    "const view = <Row trailing={/* motion: Finished status */ status === null ? null : <Dot />} />;",
    "const view = <Pane working={working ? label : null} />;",
  ],
  invalid: [
    {
      // An element swapped for another in place changes without a decided motion.
      code: "const view = <p>{ready ? <A /> : <B />}</p>;",
      errors: [{ messageId: "undecided" }],
    },
    {
      code: "const view = <Row trailing={status === null ? null : <Dot />} />;",
      errors: [{ messageId: "undecided" }],
    },
    {
      code: "const view = <p>{failure === null ? null : <Alert />}</p>;",
      errors: [{ messageId: "undecided" }],
    },
    { code: "const view = <p>{open && <Menu />}</p>;", errors: [{ messageId: "undecided" }] },
    {
      code: "const view = <>{shown ? <Note /> : undefined}</>;",
      errors: [{ messageId: "undecided" }],
    },
    {
      code: "const view = <p>\n  {/* why it shows */}\n  {open && <Menu />}\n</p>;",
      errors: [{ messageId: "undecided" }],
    },
  ],
});
