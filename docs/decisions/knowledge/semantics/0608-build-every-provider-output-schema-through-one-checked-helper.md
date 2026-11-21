# ADR-0608: Build every provider output schema through one checked helper

Status: `accepted`
Decision date: 2026-11-21
Amends: [ADR-0604](0604-share-one-review-contract-per-candidate-and-cache-only-accepted-answers.md) (the provider schema guard)

## Context

ADR-0604's first guard matched hash-like property names in schema literals. A schema could still escape it: built with a spread, computed keys, a `required` list built at runtime, a hash offered as an `enum` value, or Zod. The supervision reasoning schema narrowed its operations with `{ ...schema, properties: ... }`, which no name check reads.

## Decision

### One helper brands every provider output schema

`providerOutputSchema` in `@lervo/schemas` (re-exported by `@lervo/repository-knowledge`) is the one way to build a schema a provider answers in. It checks the schema it is given, whatever built it, and returns it branded as `ProviderOutputSchema`. It refuses:

- a property or `required` name whose last word names a value a model would copy back: `hash`, `digest`, `sha`, `fingerprint`, `checksum`, `revision`, `oid` or `ref`, in any case and plural;
- a `required` that is not a list of names;
- an `enum`, `const`, `default`, `examples` or `pattern` value that is a hash, with or without an algorithm prefix, and a `description` that holds one.

The brand is a type-only property, `__providerOutputSchema`, which no value carries and any declaration can name.

### TypeScript enforces it at every provider boundary

Every place that hands a schema to a provider accepts only `ProviderOutputSchema`, so TypeScript refuses any other:

- the Codex and Claude adapter options and Codex turn options;
- the managed run, managed deliberation and managed provider runtime paths;
- the conversation read responder and the writing evaluator;
- `ProviderJsonRequest`, the request every no-capability provider runner takes, with its response contract;
- the stage contracts that carry a schema.

### The schema and the prompt are checked against each call

A schema that crosses a process boundary as JSON loses its brand, so it is checked again where it leaves for a provider: in the no-capability runner, in the Codex query runner, and in both adapters before a turn starts. `assertProviderOutputSchemaForSource` checks it whole and against the call's actual source data. A property name or offered value that equals an identifier (`prefix_id` whose id holds a digit) or hash the source holds, or shares a run of 8 or more hex digits with one, fails. The document normalization call is checked against its own envelope too. Each adapter checks before it marks a turn active, so a refused schema leaves no turn behind.

A path or an anchor is the one kind of offered value that repeats the source by design. The shared reference helper marks each `enum` it builds with its kind through `providerReferenceEnum(values, kind)`: `reference` for `s1`-style references, `path` for repository paths, and `anchor` for hunk anchors. An owner rule document is `docs/instructions/generated/rule_<24 hex>.md`, and a hunk anchor can quote a commit SHA, yet the parser binds either one to the item its reference names. The source check therefore skips `path` and `anchor` values and checks every other offered value, references included. The kind is the `x-lervo-ref-kind` key inside the `enum` node, so it survives every rebuild, clone, native conversion and JSON crossing between the helper and the check. Each runner and adapter checks the schema as built and only then removes the key with `providerWireSchema`, so a provider never receives it. A marked value must have its kind's shape, so a mark cannot wave through an identifier or hash:

- a `path` is repository-relative, holds no `.` or `..` segment and no 32-digit hex run in a directory, and is more than an identifier or a hash; a file name such as `rule_<hex>.md` may hold hex but is never only hex, as `a/<64 hex>` would be;
- an `anchor` is an `old -> new` pair of document lines, at least one of which still holds letters or digits once its identifiers and hex runs are taken out.

`assertProviderPromptAsksNoHashCopy` checks Lervo's own words, never the untrusted data a call carries: a system prompt, the request's instruction fields, the owner reasoning and research brief instructions, and every turn input. A sentence that asks to copy, echo or return something exactly and names a hash fails, and so does a hash value with such a request within 120 characters.

A turn request names its `untrustedInstructions`: the parts Lervo did not write, which are the owner's task, role and skill text, and repository or conversation data. The orchestrator and both adapters check the rest before the turn starts. Each declared part must occur in the input. A turn that declares nothing counts as all Lervo's, so a builder that forgets its data is refused rather than skipped. The managed run, deliberation, supervision reasoning, conversation, delegated host and writing evaluator turns declare theirs. A conversation turn is one JSON object, and `providerJsonTurnUntrusted` declares each of its data fields.

### An `any` value cannot carry a schema past the brand

A value typed `any` satisfies every type, so it could reach a boundary without the brand. The ESLint rule `lervo-provider-schema/no-any-provider-schema` reads types in production source. Where the expected type carries the brand, itself or up to two fields deep as in `ProviderJsonRequest.responseContract.schema`, an `any` value fails, such as an unchecked `JSON.parse`. A call argument is held to its parameter as declared, so a generic parameter inferred from `any` still fails. Object fields, initializers, returns and assignments are held to their expected types. `@typescript-eslint/no-unsafe-argument` would report 227 sites that never touch a provider, so the rule targets the brand alone.

### The scan reads source with the TypeScript compiler

`pnpm architecture:check` runs `scripts/quality/check-provider-schema-hashes.mjs`. It parses production source under `apps/`, `packages/` and `scripts/` with the TypeScript compiler, so template literals, regular expressions, shorthand properties and comments are read exactly. It fails on:

- any object with a `properties` member, siblings or not, outside a `providerOutputSchema(...)` call;
- any use of Zod;
- `Object.assign` of a schema;
- a cast to `ProviderOutputSchema`, the brand's key written outside the helper, or `JSON.parse(...)` handed straight to a schema field, any of which would skip the helper;
- the `x-lervo-ref-kind` key written outside the helper's file, which would let the source check skip a value;
- a hash-like name, also as a shorthand property;
- a `required` that is not a literal list;
- a literal `enum` or `const` value that is a hash;
- `properties` built at runtime, a computed key, or a spread.

`packages/schemas/src` is scanned too. Its event and record schemas are Lervo's own and may stay outside the helper, but any schema there inside the helper is held to the provider rules. A cast to the brand, the brand's key or a parsed schema is refused there as anywhere else; only the helper's own file names the brand. A symbol that builds a schema-like object for another reason needs a `constructions` entry naming its file and symbol, with a reason; a whole file is never exempt, and an entry whose symbol builds nothing any more fails. The entries are the Discord gateway's identify payload, CycloneDX SBOM `properties`, two offline natural-language evaluation schemas, an evaluation pilot whose measured variable is exact marker copying, and the scan's and the lint rule's own use of the brand key. A name that must stay needs an `entries` item; there are none.

All 37 provider schemas go through the helper. The owner reasoning schema, which supervision narrowed with a spread, is now one literal builder, and two `required` lists became literal.

### The owner reasoning decision cites references

The owner reasoning decision follows the same rule. Its details never carry a hash. `prepare_publication` and `prepare_completion` return only `writingPolicyId` and `checks`, with `assignmentId` for completion and `researchChecks` for research roles. The Node binds the one valid result itself: the accepted goal result, or the assignment's single returned artifact. Where the owner chooses, the prompt labels each candidate with a short reference built only from canonical facts: pending incoming handoffs are `h1, h2, …`, and returned result artifacts are `e1, e2, …`. `accept_team_support` returns `handoffReference`, and a scoped request returns `evidenceReferences`. The Node maps them back to the exact `handoffHash` and `evidenceArtifactHashes` before the existing checks, so the offer, acceptance and request artifacts are unchanged. An unknown reference, or a hash the model returns itself, is refused as an invalid owner proposal. A decision recorded before this change still verifies when its `resultContentHash` equals the bound hash.

Two identifiers are not references. `assignmentId` and `recipientProjectId` stay as the Node's canonical ids (`asg_…` and `prj_…`) inside `details`, which the schema types as one JSON string, so no schema names or offers them. The Node accepts one only when it equals exactly one returned leased assignment or one available peer in the canonical facts. A garbled id matches nothing and is refused as an invalid owner proposal, so it can never bind another item. No hash is copied.

### Research cites its sources by id

The research brief asked its worker to copy each cited source's URL, retrieval time and content hash, and the input hash, into its provenance comment. The comment now lists the ids of the cited sources only, as schema version 2. Lervo binds each source's retrieval time and content hash, and the input hash, from the prepared inputs, and still checks each footnote URL. A version 1 comment recorded before is still checked field by field against the inputs.

## Consequences

- A new stage cannot ask a provider to copy a hash, and its schema cannot name or offer an identifier or hash. TypeScript refuses an unbranded schema at the boundary, the lint refuses an `any` one, the scan fails any other construction, and the runtime check fails a schema whose built value names or offers one, including one taken from the call's own data. Only a marked path or anchor may repeat the source. The owner reasoning details name `assignmentId` and `recipientProjectId` as exact canonical ids, refused unless they match.
- The helper returns the schema unchanged, so contracts and types stay as they were.

## Verification

Each of these tests fails with its fix reverted.

- `provider-schema-hashes.test.mjs`: a forged brand, a cast to the brand, a parsed schema and a hand-written reference-kind mark fail inside a non-provider scope, and only the helper's file names the brand. The guard names copied values by their last word. It rejects them in properties, shorthand and `required`, and rejects a schema outside the helper, even without siblings, and `Object.assign`. It reads template literals and regular expressions with quotes exactly. It rejects Zod, hash values, a `required` built at runtime, spreads and computed keys. It holds non-provider scopes only to their helper schemas, and fails a stale or unexplained allowlist entry.
- `provider-output-schema.test.ts`: the helper refuses a computed hash name, a nested `required` hash, the new name words, hash values in `enum` and `const`, a `required` that is not a list, and a schema that names or offers an identifier or hex run from the source data. A marked path or anchor holding hex passes, while the same value offered any other way fails. Only a turn input's undeclared parts are checked, a declared part the input lacks fails, and each JSON data field is declared.
- `normalization-review-contract.test.ts` and `document-freshness-cross-check.test.ts`: a `rule_<hex>.md` source path and a hunk anchor that quotes a commit SHA pass the source check, and the same value offered as a plain `enum` fails.
- `process-compiler.test.ts` for both providers, `provider-query-runner-codex.test.ts`, and the Claude and Codex adapter tests: a request built by the shared reference helper, rebuilt from JSON, reaches the provider with a `rule_<hex>.md` path and an anchor that quotes a SHA, and neither the schema nor the prompt the provider receives holds the mark. The same values unmarked are refused before any call. `provider-output-schema.test.ts` holds each kind to its shape.
- `eslint-provider-schema-any-rule.test.mjs`: an `any` argument, generic argument, request, nested request field, option field, initializer, return and assignment fail where the brand is expected, and `any` elsewhere passes.
- `research-brief.test.ts`: the research instructions name no hash, a version 2 comment binds each source from the inputs, and an unknown id, an extra field or an unknown version fails.
- `provider-output-schema-boundaries.test.ts`: every provider boundary refuses an unchecked schema by type.
- The Claude and Codex adapter tests, `process-compiler.test.ts` and `provider-query-runner-codex.test.ts`: each adapter and runner, the normalization call included, refuses a schema or prompt that copies source data before any provider call. Each adapter refuses a turn whose own words ask to copy a hash, and starts the same turn when those words are the owner's.
- `supervision-reasoning-references.test.ts` and `supervision-native-publication.test.ts`: the owner decision binds its hashes from references and refuses unknown ones, and its instructions ask for no hash.
