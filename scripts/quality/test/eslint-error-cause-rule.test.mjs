import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";

import { requireCaughtErrorCauseRule } from "../lib/eslint-error-cause-rule.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

ruleTester.run("require-caught-error-cause", requireCaughtErrorCauseRule, {
  valid: [
    'try { run(); } catch (error) { throw new Error("Run failed.", { cause: error }); }',
    'try { run(); } catch (error) { throw new StoreError("store_failed", "Run failed.", { cause: error }); }',
    'try { run(); } catch (error) { throw new errors.StoreError("store_failed", "Run failed.", { "cause": error }); }',
    'try { run(); } catch (error) { throw new StoreError("store_failed", "Run failed.", { ...options }); }',
    "try { run(); } catch (error) { throw new WrappedError(error); }",
    "try { run(); } catch (error) { throw error; }",
    'try { run(); } catch (error) { failures.push(() => { throw new Error("Later."); }); }',
    'try { run(); } catch (error) { throw toFailure(error, "Run failed."); }',
    'function fail() { throw new Error("Not in a catch clause."); }',
  ],
  invalid: [
    {
      code: 'try { run(); } catch (error) { throw new Error("Run failed."); }',
      errors: [{ messageId: "missingCause", data: { name: "Error" } }],
    },
    {
      code: 'try { run(); } catch (error) { throw new StoreError("store_failed", "Run failed."); }',
      errors: [{ messageId: "missingCause", data: { name: "StoreError" } }],
    },
    {
      code: 'try { run(); } catch (error) { throw new StoreError("store_failed", "Run failed.", { code: 1 }); }',
      errors: [{ messageId: "missingCause", data: { name: "StoreError" } }],
    },
    {
      code: 'try { run(); } catch (error) { if (retry) { throw TypeError("Run failed."); } }',
      errors: [{ messageId: "missingCause", data: { name: "TypeError" } }],
    },
    {
      code: 'try { run(); } catch { throw new StoreError("store_failed", "Run failed."); }',
      errors: [{ messageId: "discardedCatchParameter", data: { name: "StoreError" } }],
    },
  ],
});
