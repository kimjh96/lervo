import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  applicationCommandNames,
  applicationResultSchemas,
  baseApplicationCommandNames,
  coreCommandRequestSchema,
  coreLinkProtocolDocument,
  coreLinkRequestSchemas,
  coreLinkResponseSchemas,
  validateCoreLinkRequest,
} from "@lervo/session-host-contract";

// @ts-expect-error The build script has no type declarations.
import { compileCoreLinkValidator } from "../scripts/compile-core-link-validator.mjs";

const packageRoot = join(import.meta.dirname, "..");
const fixtureRoot = join(import.meta.dirname, "fixtures", "core-link");

async function fixtures(directory: string): Promise<readonly (readonly [string, unknown])[]> {
  const names = (await readdir(join(fixtureRoot, directory))).filter((name) =>
    name.endsWith(".json"),
  );
  names.sort();
  return Promise.all(
    names.map(
      async (name) =>
        [name, JSON.parse(await readFile(join(fixtureRoot, directory, name), "utf8"))] as const,
    ),
  );
}

function validators() {
  const document = coreLinkProtocolDocument();
  const id = String(document.$id);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(document);
  const find = (reference: string) => {
    const validator = ajv.getSchema(reference);
    if (validator === undefined) throw new Error(`Missing schema ${reference}.`);
    return validator;
  };
  return {
    any: find(id),
    request: find(`${id}#/$defs/CoreLinkRequest`),
    response: find(`${id}#/$defs/CoreLinkResponse`),
    result: (command: keyof typeof applicationResultSchemas) =>
      find(`${id}#/$defs/${applicationResultSchemas[command].title}`),
  };
}

function kinds(
  schemas: readonly {
    readonly properties: { readonly kind: { readonly enum: readonly [string] } };
  }[],
) {
  return schemas.map((schema) => schema.properties.kind.enum[0]).toSorted();
}

describe("core-link protocol contract", () => {
  const validate = validators();

  it("accepts every request and response fixture on its own side only", async () => {
    for (const [name, value] of await fixtures("requests")) {
      expect(validate.request(value), `${name}: ${JSON.stringify(validate.request.errors)}`).toBe(
        true,
      );
      expect(validate.response(value), name).toBe(false);
    }
    for (const [name, value] of await fixtures("responses")) {
      expect(validate.response(value), `${name}: ${JSON.stringify(validate.response.errors)}`).toBe(
        true,
      );
      expect(validate.request(value), name).toBe(false);
    }
  });

  it("rejects every invalid fixture", async () => {
    for (const [name, value] of await fixtures("invalid"))
      expect(validate.any(value), name).toBe(false);
  });

  it("has a valid fixture for every message kind", async () => {
    const seen = async (directory: string) =>
      [
        ...new Set(
          (await fixtures(directory)).map(([, value]) => (value as { kind: string }).kind),
        ),
      ].toSorted();
    expect(await seen("requests")).toEqual(kinds(coreLinkRequestSchemas));
    expect(await seen("responses")).toEqual(kinds(coreLinkResponseSchemas));
  });

  it("names one result schema for every application command", () => {
    expect(coreCommandRequestSchema.properties.command.enum).toEqual(applicationCommandNames);
    expect(Object.keys(applicationResultSchemas).toSorted()).toEqual(
      [...applicationCommandNames].toSorted(),
    );
    for (const base of baseApplicationCommandNames) expect(applicationCommandNames).toContain(base);
  });

  it("names each result schema after its command, as the session host looks it up", () => {
    // `provider.list` has `ProviderListResult` (apps/ade/session-protocol/src/core_link.rs).
    const title = (command: string) =>
      `${command
        .split(/[._]/u)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("")}Result`;
    for (const command of applicationCommandNames)
      expect(applicationResultSchemas[command].title).toBe(title(command));
  });

  it("accepts every result fixture, with or without the fields an older core omits", async () => {
    const names = new Map<string, keyof typeof applicationResultSchemas>([
      ["provider-list", "provider.list"],
      ["repository-list", "repository.list"],
      ["repository-list-profiles", "repository.list"],
      ["project-add", "project.add"],
      ["project-mark-read", "project.mark.read"],
      ["workspace-list", "workspace.list"],
      ["workspace-list-older-core", "workspace.list"],
      ["workspace-start", "workspace.start"],
    ]);
    const results = await fixtures("results");
    expect(results.map(([name]) => name.replace(/\.json$/u, "")).toSorted()).toEqual(
      [...names.keys()].toSorted(),
    );
    for (const [name, value] of results) {
      const validator = validate.result(names.get(name.replace(/\.json$/u, ""))!);
      expect(validator(value), `${name}: ${JSON.stringify(validator.errors)}`).toBe(true);
    }
  });

  it("lets a newer core add result properties", async () => {
    const [, list] = (await fixtures("results")).find(([name]) => name === "workspace-list.json")!;
    const extended = { ...(list as object), pinned: [] };
    expect(validate.result("workspace.list")(extended)).toBe(true);
  });

  it("rejects every invalid result fixture", async () => {
    for (const [name, value] of await fixtures("invalid-results")) {
      const { command, result } = value as {
        command: keyof typeof applicationResultSchemas;
        result: unknown;
      };
      expect(validate.result(command)(result), name).toBe(false);
    }
  });

  it("keeps the generated document for the Rust session host current", async () => {
    const committed = JSON.parse(
      await readFile(join(packageRoot, "generated/core-link-protocol.schema.json"), "utf8"),
    );
    expect(
      committed,
      "Run `pnpm --filter @lervo/session-host-contract build` to regenerate the document.",
    ).toEqual(coreLinkProtocolDocument());
  });

  it("ships a standalone request validator that is current and agrees with the schema", async () => {
    expect(
      await readFile(join(packageRoot, "generated/core-link-request-validator.js"), "utf8"),
      "Run `pnpm --filter @lervo/session-host-contract build` to regenerate the validator.",
    ).toBe(await compileCoreLinkValidator(coreLinkProtocolDocument()));
    for (const directory of ["requests", "responses", "invalid"])
      for (const [name, value] of await fixtures(directory))
        expect(validateCoreLinkRequest(value), `${directory}/${name}`).toBe(
          validate.request(value),
        );
  });
});
