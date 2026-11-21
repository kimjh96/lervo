import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";

import { noAnyProviderSchemaRule } from "../lib/eslint-provider-schema-any-rule.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// A self-contained project: the brand, a schema boundary, and a request that carries a schema.
const root = mkdtempSync(join(tmpdir(), "lervo-provider-schema-any-"));
writeFileSync(
  join(root, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] }),
);
const prelude = `
type ProviderOutputSchema = { readonly __providerOutputSchema: true };
interface ProviderJsonRequest { responseContract: { schema: ProviderOutputSchema } }
declare function providerOutputSchema<T extends object>(schema: T): T & ProviderOutputSchema;
declare function send(schema: ProviderOutputSchema): void;
declare function query(request: ProviderJsonRequest): void;
declare function sendLater<T extends ProviderOutputSchema>(schema: T): void;
declare function log(value: unknown): void;
declare const loose: any;
declare const text: string;
`;
writeFileSync(join(root, "file.ts"), "");

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { project: "./tsconfig.json", tsconfigRootDir: root },
  },
});
const filename = join(root, "file.ts");
const invalid = (code) => ({
  code: prelude + code,
  filename,
  errors: [{ messageId: "anySchema" }],
});

ruleTester.run("no-any-provider-schema", noAnyProviderSchemaRule, {
  valid: [
    "send(providerOutputSchema({ type: 'object' }));",
    "log(loose);",
    "const value: string = loose;",
    "query({ responseContract: { schema: providerOutputSchema({ type: 'object' }) } });",
    "const options: { structuredOutputSchema?: ProviderOutputSchema; label: string } = { label: loose };",
  ].map((code) => ({ code: prelude + code, filename })),
  invalid: [
    invalid("send(loose);"),
    invalid("send(JSON.parse(text));"),
    invalid("sendLater(loose);"),
    invalid("query(loose);"),
    invalid("query({ responseContract: loose });"),
    invalid("query({ responseContract: { schema: loose } });"),
    invalid(
      "const options: { structuredOutputSchema?: ProviderOutputSchema } = { structuredOutputSchema: loose };",
    ),
    invalid("const schema: ProviderOutputSchema = loose;"),
    invalid("function build(): ProviderOutputSchema { return loose; }"),
    invalid("const build = (): ProviderOutputSchema => loose;"),
    invalid("let schema: ProviderOutputSchema | null = null; schema = loose;"),
  ],
});
